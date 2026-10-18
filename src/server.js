'use strict';
// Zero-dependency HTTP wrapper. POST /task {taskType, prompt}, GET /status, GET /health.

const http = require('http');
const fs = require('fs');
const path = require('path');
const Orchestrator = require('./orchestrator');
const { claudeCli, geminiApi } = require('./providers');

function createServer(orchestrator) {
  return http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/health') return send(200, { status: 'online' });
    if (req.method === 'GET' && req.url === '/status') return send(200, orchestrator.status());
    if (req.method === 'POST' && req.url === '/task') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body;
      try { body = JSON.parse(raw); } catch { return send(400, { error: 'invalid JSON' }); }
      if (!body.prompt) return send(400, { error: 'prompt is required' });
      try { return send(200, await orchestrator.run(body.taskType || 'general', body.prompt)); }
      catch (err) { return send(502, { error: err.message }); }
    }
    send(404, { error: 'not found' });
  });
}

if (require.main === module) {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'routes.json'), 'utf8'));
  const orchestrator = new Orchestrator({
    config,
    providers: { claude: claudeCli(), gemini: geminiApi({ apiKey: process.env.GEMINI_API_KEY }) },
    system: process.env.SYSTEM_PROMPT_FILE ? fs.readFileSync(process.env.SYSTEM_PROMPT_FILE, 'utf8') : null,
  });
  const port = Number(process.env.PORT || 3100);
  createServer(orchestrator).listen(port, '127.0.0.1', () => console.log(`orchestrator on http://127.0.0.1:${port}`));
}

module.exports = { createServer };
