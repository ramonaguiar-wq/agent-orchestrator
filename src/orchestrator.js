'use strict';
// route -> session -> call -> record. If the chosen model fails, the route's fallback gets one try.

const Router = require('./router');
const SessionManager = require('./session-manager');

class Orchestrator {
  constructor({ config, providers, sessions = new SessionManager(), system = null }) {
    this.router = new Router(config);
    this.providers = providers;
    this.sessions = sessions;
    this.system = system;
    this.log = [];
  }

  async run(taskType, prompt, options = {}) {
    const choice = this.router.select(taskType, this.sessions.usageByModel());
    const attempts = [choice.model, choice.fallback].filter(Boolean);
    let lastError;

    for (const model of attempts) {
      const call = this.providers[model];
      if (!call) { lastError = new Error(`no provider for ${model}`); continue; }
      const session = this.sessions.forModel(model);
      try {
        const system = [this.system, options.system].filter(Boolean).join('\n\n') || undefined;
        const result = await call(prompt, { system });
        this.sessions.record(session.id, { ...result });
        const entry = { taskType, model, sessionId: session.id, reason: model === choice.model ? choice.reason : `fallback after ${choice.model} failed`, status: 'OK' };
        this.log.push(entry);
        return { ...entry, response: result.response, health: this.sessions.health(session.id), repetition: this.sessions.repetition(session.id) };
      } catch (err) {
        lastError = err;
        this.log.push({ taskType, model, sessionId: session.id, status: 'FAILED', error: err.message });
      }
    }
    throw lastError;
  }

  status() {
    return { usage: this.sessions.usageByModel(), tasks: this.log.length, failures: this.log.filter((e) => e.status === 'FAILED').length };
  }
}

module.exports = Orchestrator;
