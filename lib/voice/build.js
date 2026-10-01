#!/usr/bin/env node
'use strict';
/**
 * Rebuild voice cards: read new WhatsApp sends, take in what agents logged
 * to the inbox, then write one card per channel and one per person or chat
 * you've sent 30+ messages to. Plain node, no tokens. Runs nightly.
 *
 *   node build.js
 */
const fs = require('fs');
const path = require('path');
const { loadUsageConfig } = require('../config');
const sends = require('./sends');
const card = require('./card');
const whatsapp = require('./collect-whatsapp');
const { loadPeople, peopleIn } = require('../usage/entities');
const store = require('../usage/store');
const corrections = require('../corrections');
const words = require('./words');

function slug(s) { return String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'unnamed'; }

function build() {
  const c = loadUsageConfig();
  const D = sends.dirs(c.dir);
  const wa = whatsapp.collect();
  const inbox = sends.drainInbox(c.dir);
  fs.mkdirSync(c.voice.cardDir, { recursive: true });
  fs.mkdirSync(D.cards, { recursive: true });
  const opts = { particles: c.particles, languages: c.languages };
  const people = loadPeople(c);
  const canonTo = (t) => (peopleIn(String(t), people)[0] || t); // "Dan" and "Dana" are one card
  const written = [];
  const index = [];
  const rules = corrections.active(c.dir);
  // The base card: how you write to your AI. Every channel falls back to it until it has its own.
  {
    const P = store.paths(c.dir);
    const base = { ...card.fromEvents(store.readAll(P.events), store.readAll(P.terms)), rules, to: null };
    if (base.sends) {
      fs.writeFileSync(path.join(D.cards, 'you.json'), JSON.stringify(base));
      fs.writeFileSync(path.join(c.voice.cardDir, 'you.md'), card.toMarkdown(base));
      written.push('you');
      index.push({ key: 'you', channel: 'ai', to: null, sends: base.sends });
    }
  }
  const own = []; // every clean send, all channels: one vocabulary
  const drafts = []; // what was kept out: the contrast for your words
  for (const ch of c.voice.channels) {
    const ai = sends.aiSent(c.dir);
    // Keep out anything your AI sent for you, and AI drafts you pasted and sent yourself.
    const rows = [];
    for (const r of sends.read(c.dir, ch)) (sends.isAi(ai, r.text) || sends.isPasted(r.text) ? drafts : rows).push(r);
    if (!rows.length) continue;
    own.push(...rows);
    const cards = [{ key: ch, label: ch, rows }];
    const byTo = {};
    for (const r of rows) if (r.to) { const t = canonTo(r.to); (byTo[t] = byTo[t] || []).push(r); }
    for (const [to, list] of Object.entries(byTo)) {
      if (list.length < c.voice.minSends) continue;
      const group = list.every((r) => r.group); // a group chat, not a person
      cards.push({ key: `${ch}--${slug(to)}`, label: `${ch}, ${group ? 'in' : 'to'} ${to}`, to, group, rows: list });
    }
    for (const k of cards) {
      const cardObj = { ...card.build(k.rows, { ...opts, channel: ch, label: k.label }), to: k.to || null, group: !!k.group, rules, source: `from ${k.rows.length} of your ${ch === 'email' ? 'emails' : `${ch} messages`}${k.to ? ` ${k.group ? 'in' : 'to'} ${k.to}` : ''}` };
      fs.writeFileSync(path.join(D.cards, k.key + '.json'), JSON.stringify(cardObj));
      fs.writeFileSync(path.join(c.voice.cardDir, k.key + '.md'), card.toMarkdown(cardObj));
      written.push(k.key);
      index.push({ key: k.key, channel: ch, to: k.to || null, sends: cardObj.sends });
    }
  }
  if (own.length) {
    const vocab = words.buildVocab(own, drafts);
    fs.writeFileSync(path.join(D.cards, 'words.json'), JSON.stringify(vocab));
    fs.writeFileSync(path.join(c.voice.cardDir, 'words.md'), words.toMarkdown(vocab));
    written.push('words');
  }
  fs.writeFileSync(path.join(D.cards, 'index.json'), JSON.stringify(index));
  return { whatsapp: wa, inbox, cards: written };
}

module.exports = { build, slug };

if (require.main === module) {
  const r = build();
  console.log(`voice: whatsapp ${r.whatsapp.skipped || `+${r.whatsapp.added}`}, inbox +${r.inbox}, ${r.cards.length} cards`);
}
