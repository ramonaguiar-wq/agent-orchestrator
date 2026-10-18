'use strict';
// Tracks token use per session and says when to open a fresh one.
// Long sessions degrade: the manager flags them before the limit and detects repeated answers.

const crypto = require('crypto');

class SessionManager {
  constructor({ maxTokens = 100000, warnAt = 0.7, degradeAt = 0.8, now = () => Date.now() } = {}) {
    this.maxTokens = maxTokens;
    this.warnAt = warnAt;
    this.degradeAt = degradeAt;
    this.now = now;
    this.sessions = new Map();
    this.seq = 0;
  }

  create(model) {
    const id = `${model}-${this.now()}-${++this.seq}`;
    const s = { id, model, tokens: 0, history: [], status: 'ACTIVE', createdAt: this.now() };
    this.sessions.set(id, s);
    return s;
  }

  // Active session for a model, or a new one if none exists or the last one is full.
  forModel(model) {
    for (const s of this.sessions.values()) {
      if (s.model === model && s.status === 'ACTIVE' && this.health(s.id).status !== 'FULL') return s;
    }
    return this.create(model);
  }

  record(id, { inputTokens, outputTokens, response }) {
    const s = this.sessions.get(id);
    if (!s) return null;
    s.tokens += inputTokens + outputTokens;
    s.history.push(crypto.createHash('sha1').update(response).digest('hex'));
    if (s.history.length > 20) s.history.shift();
    return s;
  }

  health(id) {
    const s = this.sessions.get(id);
    if (!s) return { status: 'NOT_FOUND' };
    const ratio = s.tokens / this.maxTokens;
    let status = 'HEALTHY';
    if (ratio >= 1) status = 'FULL';
    else if (ratio >= this.degradeAt) status = 'DEGRADING';
    else if (ratio >= this.warnAt) status = 'WARNING';
    return { id, status, tokens: s.tokens, remaining: Math.max(0, this.maxTokens - s.tokens), used: +(ratio * 100).toFixed(1) };
  }

  // Two identical answers among the last three means the session is looping.
  repetition(id) {
    const s = this.sessions.get(id);
    if (!s || s.history.length < 3) return { status: 'INSUFFICIENT_DATA' };
    const last = s.history.slice(-3);
    const looping = new Set(last).size < last.length;
    return { status: looping ? 'DEGRADED' : 'NORMAL', action: looping ? 'RESET_CONTEXT' : null };
  }

  close(id, reason = 'MANUAL') {
    const s = this.sessions.get(id);
    if (s) { s.status = 'CLOSED'; s.closeReason = reason; }
    return s || null;
  }

  usageByModel() {
    const out = {};
    for (const s of this.sessions.values()) out[s.model] = (out[s.model] || 0) + s.tokens;
    return out;
  }
}

module.exports = SessionManager;
