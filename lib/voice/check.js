#!/usr/bin/env node
'use strict';
/**
 * Check a draft against how you write in that channel (and to that person).
 *
 *   node check.js --channel discord [--to "Gee"] "the draft text"
 *   echo "draft" | node check.js --channel email --to "Alex"
 *
 * Exit 2 when the draft is out of your range on 2+ measures (the model
 * should rewrite from your last sends in that thread); 0 otherwise.
 */
const fs = require('fs');
const path = require('path');
const { loadUsageConfig } = require('../config');
const { loadPeople, peopleIn } = require('../usage/entities');
const sends = require('./sends');
const { check } = require('./score');

/** Most specific card: the person or chat, then the channel. */
function pickCard(channel, to, c) {
  const dir = sends.dirs(c.dir).cards;
  let index = [];
  try { index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch { return null; }
  const load = (key) => { try { return JSON.parse(fs.readFileSync(path.join(dir, key + '.json'), 'utf8')); } catch { return null; } };
  if (to) {
    const people = loadPeople(c);
    const names = new Set([String(to).toLowerCase(), ...peopleIn(String(to), people).map((n) => n.toLowerCase())]);
    const hit = index.find((i) => i.channel === channel && i.to && names.has(String(i.to).toLowerCase()));
    if (hit) return load(hit.key);
  }
  return index.some((i) => i.key === channel) ? load(channel) : null;
}

function run(channel, to, text) {
  const c = loadUsageConfig();
  const card = pickCard(channel, to, c);
  if (!card) return { card: null, findings: [], block: false, note: `no voice card for ${channel} yet` };
  return { card: card.label, ...check(text, card, c.voice) };
}

function format(r) {
  if (!r.card) return `voice: ${r.note}; sample your last sends in this thread by hand.`;
  if (!r.findings.length) return `voice: fits how you write on ${r.card} (card from ${r.cardSends} sends).`;
  return [`voice: ${r.block ? 'OUT OF VOICE' : 'check'} on ${r.card} (card from ${r.cardSends} sends)`, ...r.findings.map((f) => `- ${f.text}`),
    r.block ? 'Rewrite from his last 10-20 sends in this exact thread, then check again.' : ''].filter(Boolean).join('\n');
}

module.exports = { run, pickCard, format };

if (require.main === module) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const channel = get('--channel');
  const to = get('--to');
  const json = a.includes('--json'); if (json) a.splice(a.indexOf('--json'), 1);
  const text = a.length ? a.join(' ') : fs.readFileSync(0, 'utf8');
  if (!channel) { console.error('usage: node check.js --channel <whatsapp|telegram|discord|email|gchat|teams> [--to name] "draft"'); process.exit(1); }
  const r = run(channel, to, text);
  console.log(json ? JSON.stringify(r, null, 1) : format(r));
  process.exit(r.block ? 2 : 0);
}
