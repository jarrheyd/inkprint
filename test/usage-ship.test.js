'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const U = path.join(path.resolve(__dirname, '..'), 'lib', 'usage');

function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b, type: res.headers['content-type'] })); }).on('error', reject);
  });
}

test('serve: page and metrics come up on localhost', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-usage-serve-'));
  const dir = path.join(tmp, 'claude', '-p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's.jsonl'), JSON.stringify({ sessionId: 's', cwd: '/w/app', type: 'user', uuid: 'u1', timestamp: new Date().toISOString(), promptSource: 'typed', origin: { kind: 'human' }, message: { content: 'ship the page' } }) + '\n');
  const cfg = path.join(tmp, 'os.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ identity: { timezone: 'UTC' }, paths: { vaultRoot: '' }, usage: { model: false } }));
  const port = 40000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(U, 'serve.js'), String(port)], {
    env: { ...process.env, HELM_CONFIG: cfg, HELM_USAGE_DIR: path.join(tmp, 'out'), HELM_CLAUDE_PROJECTS: path.join(tmp, 'claude'), HELM_CODEX_SESSIONS: path.join(tmp, 'none') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('server did not start')), 10000);
      child.stdout.on('data', (d) => { if (String(d).includes('http://127.0.0.1')) { clearTimeout(t); resolve(); } });
    });
    const page = await get(port, '/');
    assert.strictEqual(page.status, 200);
    assert.match(page.body, /How you work with AI/);
    const m = JSON.parse((await get(port, '/api/metrics')).body);
    assert.strictEqual(m.you.prompts, 1);
    assert.strictEqual((await get(port, '/nope')).status, 404);
  } finally { child.kill(); }
});
