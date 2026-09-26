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
  for (const ch of c.voice.channels) {
    const rows = sends.read(c.dir, ch);
    if (!rows.length) continue;
    const cards = [{ key: ch, label: ch, rows }];
    const byTo = {};
    for (const r of rows) if (r.to) { const t = canonTo(r.to); (byTo[t] = byTo[t] || []).push(r); }
    for (const [to, list] of Object.entries(byTo)) if (list.length >= c.voice.minSends) cards.push({ key: `${ch}--${slug(to)}`, label: `${ch}, to ${to}`, to, rows: list });
    for (const k of cards) {
      const cardObj = { ...card.build(k.rows, { ...opts, channel: ch, label: k.label }), to: k.to || null };
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
