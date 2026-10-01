#!/usr/bin/env node
'use strict';
/**
 * Check a draft against how you write in that channel (and to that person).
 *
 *   node check.js --channel discord [--to "Gee"] "the draft text"
 *   echo "draft" | node check.js --channel email --to "Alex"
 *   node check.js --channel doc < proposal.md      (documents: word check only)
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
const { scoreWords } = require('./words');

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
  if (index.some((i) => i.key === channel)) return load(channel);
  // No card for this channel yet: fall back to how you write to your AI, marked as the base card.
  const base = index.some((i) => i.key === 'you') ? load('you') : null;
  return base ? { ...base, channel, base: true, label: `${channel} (no ${channel} card yet, using how you write to your AI)` } : null;
}

/** Your pooled word list, built nightly with the cards. */
function loadVocab(c) {
  try { return JSON.parse(fs.readFileSync(path.join(sends.dirs(c.dir).cards, 'words.json'), 'utf8')); } catch { return null; }
}

function run(channel, to, text) {
  const c = loadUsageConfig();
  const vocab = loadVocab(c);
  const words = () => scoreWords(text, vocab).map((w) => ({ hard: false, kind: 'word', text: w.text }));
  // A document has no usual length or greeting to hold it to: words only.
  if (channel === 'doc') {
    if (!vocab) return { card: null, findings: [], block: false, note: 'no word list yet' };
    return { card: 'your documents', findings: words(), block: false, cardSends: vocab.sends, hard: 0, source: 'word list' };
  }
  const card = pickCard(channel, to, c);
  if (!card) return { card: null, findings: vocab ? words() : [], block: false, note: `no voice card for ${channel} yet` };
  return { card: card.label, ...check(text, card, { ...c.voice, vocab }) };
}

function format(r) {
  const lines = r.findings.map((f) => `- ${f.text}`);
  if (!r.card) return [`voice: ${r.note}; sample your last sends in this thread by hand.`, ...lines].join('\n');
  if (!r.findings.length) return `voice: fits how you write on ${r.card} (${r.source || 'card'} from ${r.cardSends} sends).`;
  return [`voice: ${r.block ? 'OUT OF VOICE' : 'check'} on ${r.card} (${r.source || 'card'} from ${r.cardSends} sends)`, ...lines,
    r.block ? 'Rewrite from the user\'s last 10-20 sends in this exact thread, then check again.' : ''].filter(Boolean).join('\n');
}

module.exports = { run, pickCard, format };

if (require.main === module) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const channel = get('--channel');
  const to = get('--to');
  const json = a.includes('--json'); if (json) a.splice(a.indexOf('--json'), 1);
  const text = a.length ? a.join(' ') : fs.readFileSync(0, 'utf8');
  if (!channel) { console.error('usage: node check.js --channel <whatsapp|telegram|discord|email|gchat|teams|doc> [--to name] "draft"'); process.exit(1); }
  const r = run(channel, to, text);
  console.log(json ? JSON.stringify(r, null, 1) : format(r));
  process.exit(r.block ? 2 : 0);
}
