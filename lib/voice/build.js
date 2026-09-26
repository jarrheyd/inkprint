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
  for (const ch of c.voice.channels) {
    const ai = sends.aiSent(c.dir);
    const rows = sends.read(c.dir, ch).filter((r) => !sends.isAi(ai, r.text)); // drop anything your AI sent for you
    if (!rows.length) continue;
    const cards = [{ key: ch, label: ch, rows }];
    const byTo = {};
    for (const r of rows) if (r.to) { const t = canonTo(r.to); (byTo[t] = byTo[t] || []).push(r); }
    for (const [to, list] of Object.entries(byTo)) if (list.length >= c.voice.minSends) cards.push({ key: `${ch}--${slug(to)}`, label: `${ch}, to ${to}`, to, rows: list });
    for (const k of cards) {
      const cardObj = { ...card.build(k.rows, { ...opts, channel: ch, label: k.label }), to: k.to || null, rules, source: `from ${k.rows.length} of your ${ch === 'email' ? 'emails' : `${ch} messages`}${k.to ? ` to ${k.to}` : ''}` };
      fs.writeFileSync(path.join(D.cards, k.key + '.json'), JSON.stringify(cardObj));
      fs.writeFileSync(path.join(c.voice.cardDir, k.key + '.md'), card.toMarkdown(cardObj));
      written.push(k.key);
      index.push({ key: k.key, channel: ch, to: k.to || null, sends: cardObj.sends });
    }
  }
  fs.writeFileSync(path.join(D.cards, 'index.json'), JSON.stringify(index));
  return { whatsapp: wa, inbox, cards: written };
}

module.exports = { build, slug };

if (require.main === module) {
  const r = build();
  console.log(`voice: whatsapp ${r.whatsapp.skipped || `+${r.whatsapp.added}`}, inbox +${r.inbox}, ${r.cards.length} cards`);
}
