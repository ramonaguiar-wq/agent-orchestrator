'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const Router = require('../src/router');
const SessionManager = require('../src/session-manager');
const Orchestrator = require('../src/orchestrator');
const { createServer } = require('../src/server');
const config = require('../config/routes.json');

const fake = (text, tokens = 100) => async () => ({ response: text, inputTokens: tokens, outputTokens: tokens });

test('router: known task goes to its configured model', () => {
  const r = new Router(config);
  assert.strictEqual(r.select('design_analysis').model, 'claude');
  assert.strictEqual(r.select('quick_summary').model, 'gemini');
});

test('router: unknown task uses the default route', () => {
  const s = new Router(config).select('whatever');
  assert.strictEqual(s.model, 'claude');
  assert.match(s.reason, /default/);
});

test('router: reroutes to fallback once the budget is spent', () => {
  const r = new Router(config);
  const s = r.select('design_analysis', { claude: 200000 });
  assert.strictEqual(s.model, 'gemini');
  assert.strictEqual(s.rerouted, true);
  assert.strictEqual(r.select('design_analysis', { claude: 199999 }).rerouted, false);
});

test('sessions: health thresholds', () => {
  const m = new SessionManager({ maxTokens: 1000 });
  const s = m.create('claude');
  const at = (n) => { s.tokens = n; return m.health(s.id).status; };
  assert.deepStrictEqual([at(0), at(700), at(800), at(1000)], ['HEALTHY', 'WARNING', 'DEGRADING', 'FULL']);
});

test('sessions: a full session is replaced by a new one', () => {
  const m = new SessionManager({ maxTokens: 100 });
  const a = m.forModel('claude');
  m.record(a.id, { inputTokens: 60, outputTokens: 60, response: 'x' });
  assert.notStrictEqual(m.forModel('claude').id, a.id);
});

test('sessions: repeated answers are flagged', () => {
  const m = new SessionManager();
  const s = m.create('claude');
  for (const r of ['a', 'b', 'a']) m.record(s.id, { inputTokens: 1, outputTokens: 1, response: r });
  assert.strictEqual(m.repetition(s.id).status, 'DEGRADED');
  m.record(s.id, { inputTokens: 1, outputTokens: 1, response: 'c' });
  assert.strictEqual(m.repetition(s.id).status, 'NORMAL');
});

test('orchestrator: falls back when the primary provider fails', async () => {
  const o = new Orchestrator({ config, providers: { claude: async () => { throw new Error('down'); }, gemini: fake('from gemini') } });
  const out = await o.run('design_analysis', 'hi');
  assert.strictEqual(out.model, 'gemini');
  assert.match(out.reason, /fallback/);
  assert.strictEqual(o.status().failures, 1);
});

test('orchestrator: throws when every provider fails', async () => {
  const bad = async () => { throw new Error('down'); };
  const o = new Orchestrator({ config, providers: { claude: bad, gemini: bad } });
  await assert.rejects(o.run('design_analysis', 'hi'), /down/);
});

test('orchestrator: spends the claude budget, then reroutes', async () => {
  const small = { ...config, budgets: { claude: 250 } };
  const o = new Orchestrator({ config: small, providers: { claude: fake('c', 100), gemini: fake('g', 10) } });
  const models = [];
  for (let i = 0; i < 3; i++) models.push((await o.run('design_analysis', 'p')).model);
  assert.deepStrictEqual(models, ['claude', 'claude', 'gemini']);
});

test('orchestrator: system prompt reaches the provider', async () => {
  let seen;
  const o = new Orchestrator({ config, system: 'BASE', providers: { claude: async (p, opt) => { seen = opt.system; return { response: 'ok', inputTokens: 1, outputTokens: 1 }; } } });
  await o.run('design_analysis', 'hi', { system: 'EXTRA' });
  assert.strictEqual(seen, 'BASE\n\nEXTRA');
});

test('server: POST /task round trip', async () => {
  const o = new Orchestrator({ config, providers: { claude: fake('hello') } });
  const srv = createServer(o).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const port = srv.address().port;
  const post = (path, body) => new Promise((resolve) => {
    const req = http.request({ port, path, method: 'POST', host: '127.0.0.1' }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ code: res.statusCode, body: JSON.parse(d) })); });
    req.end(body);
  });
  const ok = await post('/task', JSON.stringify({ taskType: 'design_analysis', prompt: 'x' }));
  assert.strictEqual(ok.code, 200);
  assert.strictEqual(ok.body.response, 'hello');
  assert.strictEqual((await post('/task', '{bad')).code, 400);
  assert.strictEqual((await post('/task', '{}')).code, 400);
  srv.close();
});
