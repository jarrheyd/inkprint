#!/usr/bin/env node
'use strict';
/**
 * Local live dashboard. Watches the transcript folders, re-reads only what
 * changed, and pushes an update to the open page. Runs only while you have
 * it open; bound to 127.0.0.1 so nothing leaves the machine.
 *
 *   node serve.js [port=4747] [--open]
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { loadUsageConfig } = require('../config');
const { build } = require('./report');

const PORT_ARG = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.HELM_USAGE_PORT || 0);
const PAGE = path.join(__dirname, '..', '..', 'page', 'index.html');

let metrics = null;
let tuning = null;
let building = false; let again = false;
const clients = new Set();

function rebuild() {
  if (building) { again = true; return; }
  building = true;
  try {
    const t0 = Date.now();
    metrics = build();
    for (const res of clients) res.write(`event: update\ndata: ${JSON.stringify({ generated: metrics.generated, ms: Date.now() - t0 })}\n\n`);
  } catch (e) {
    console.error('usage: rebuild failed:', e.message);
  } finally {
    building = false;
    if (again) { again = false; setTimeout(rebuild, 200); }
  }
}

let timer = null;
function soon() { clearTimeout(timer); timer = setTimeout(rebuild, 1500); }

function watch(dir) {
  try { fs.watch(dir, { recursive: true }, (_ev, file) => { if (!file || String(file).endsWith('.jsonl')) soon(); }); } catch { /* folder missing */ }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/metrics') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(metrics || {}));
    return;
  }
  if (url.pathname === '/api/tune' && req.method === 'POST') {
    // Only from this page (same origin), only on a click; the page shows the cost before it asks.
    if (req.headers.origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)) { res.writeHead(403); res.end(); return; }
    if (tuning) { res.writeHead(409, { 'content-type': 'application/json' }); res.end('{"state":"running"}'); return; }
    tuning = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'inkprint.js'), 'tune', '--yes'], { env: process.env, stdio: 'ignore' });
    for (const r of clients) r.write('event: tune\ndata: {"state":"running"}\n\n');
    tuning.on('exit', (code) => { tuning = null; for (const r of clients) r.write(`event: tune\ndata: {"state":"${code ? 'failed' : 'done'}"}\n\n`); rebuild(); });
    res.writeHead(202, { 'content-type': 'application/json' }); res.end('{"state":"running"}');
    return;
  }
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(PAGE));
    return;
  }
  res.writeHead(404); res.end();
});

if (require.main === module) {
  const c = loadUsageConfig();
  
  rebuild();
  watch(c.claudeDir);
  for (const d of c.codexDirs) watch(d);
  setInterval(rebuild, 5 * 60 * 1000); // backstop if a watch event is missed
  const port = PORT_ARG || c.port;
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`inkprint: open ${url} (Ctrl-C to close)`);
    if (process.argv.includes('--open') && process.platform === 'darwin') require('child_process').spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  });
}

module.exports = { server };
