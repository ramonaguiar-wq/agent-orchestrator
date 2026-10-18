'use strict';
// Model providers. Both take a prompt and resolve { response, inputTokens, outputTokens }.
// Token counts are estimates (chars / 4) unless the API returns real ones.

const { spawn } = require('child_process');

const estimate = (text) => Math.ceil(text.length / 4);

function claudeCli({ bin = 'claude', run = spawn } = {}) {
  return async function call(prompt, { system } = {}) {
    const args = ['--print', prompt];
    if (system) args.push('--append-system-prompt', system);
    const response = await new Promise((resolve, reject) => {
      const child = run(bin, args);
      let out = '', err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`claude exited ${code}: ${err.trim()}`))));
    });
    return { response, inputTokens: estimate(prompt + (system || '')), outputTokens: estimate(response) };
  };
}

function geminiApi({ apiKey, model = 'gemini-2.0-flash', fetchFn = fetch } = {}) {
  return async function call(prompt, { system } = {}) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}`);
    const json = await res.json();
    const response = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text).join('');
    const u = json.usageMetadata || {};
    return { response, inputTokens: u.promptTokenCount ?? estimate(prompt), outputTokens: u.candidatesTokenCount ?? estimate(response) };
  };
}

module.exports = { claudeCli, geminiApi };
