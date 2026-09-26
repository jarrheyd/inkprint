#!/usr/bin/env node
'use strict';
/**
 * Print random prompts from each layer so a person can check the "you" vs
 * "os" split by eye. Reads transcripts directly; nothing is written.
 *
 *   node spotcheck.js [n=20]
 */
const fs = require('fs');
const { loadUsageConfig } = require('../config');
const claude = require('./parse-claude');
const codex = require('./parse-codex');
const { sources, readNewLines } = require('./ingest');

function sample(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

function collect(maxFiles = 400, maxBytes = 50e6) {
  const c = loadUsageConfig();
  const files = sample(sources(c).filter((s) => { try { return fs.statSync(s.file).size < maxBytes; } catch { return false; } }), maxFiles);
  const out = { you: [], os: [] };
  for (const s of files) {
    const state = { subagent: !!s.subagent };
    let n = 0;
    readNewLines(s.file, 0, fs.statSync(s.file).size, (line) => {
      n++;
      let d; try { d = JSON.parse(line); } catch { return; }
      const evs = s.tool === 'claude' ? claude.parseRecord(d, state, c.classifyOpts) : codex.parseRecord(d, state, c.classifyOpts, String(n));
      for (const e of evs) if (e.kind === 'prompt') out[e.layer].push({ id: e.id, ts: e.ts, tool: e.tool, text: e.text });
    });
  }
  return out;
}

if (require.main === module) {
  const n = Number(process.argv[2]) || 20;
  const got = collect();
  for (const layer of ['you', 'os']) {
    console.log(`\n== ${layer} (${n} of ${got[layer].length} sampled) ==`);
    for (const e of sample(got[layer], n)) console.log(`- [${e.tool}] ${e.text.replace(/\s+/g, ' ').slice(0, 140)}`);
  }
}

module.exports = { collect };
