#!/usr/bin/env node
'use strict';
/**
 * Your WhatsApp sends, read straight from the bridge's local database
 * (read-only, no tokens). Incremental: remembers the newest timestamp seen.
 * Needs `voice.whatsappDb` in config: the bridge's store/messages.db.
 */
const fs = require('fs');
const path = require('path');
const { loadUsageConfig } = require('../config');
const { loadPeople, peopleIn } = require('../usage/entities');
const sends = require('./sends');

/**
 * Names for one-to-one chats. The bridge stores contacts by phone number and
 * maps WhatsApp's anonymous ids (lid) to numbers, so both resolve to a name.
 */
function contactNames(file) {
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(file, { readOnly: true });
    try {
      const byPn = new Map();
      for (const r of d.prepare('SELECT their_jid, full_name, push_name, first_name FROM whatsmeow_contacts').all()) {
        const n = r.full_name || r.push_name || r.first_name;
        if (n) byPn.set(String(r.their_jid).split('@')[0], n);
      }
      for (const [pn, n] of byPn) out.set(pn, n);
      for (const r of d.prepare('SELECT lid, pn FROM whatsmeow_lid_map').all()) {
        const n = byPn.get(String(r.pn).split('@')[0]);
        if (n) out.set(String(r.lid).split('@')[0], n);
      }
    } finally { d.close(); }
  } catch { /* bridge schema changed: fall back to ids */ }
  return out;
}

function collect(opts = {}) {
  const c = loadUsageConfig();
  const db = opts.db || c.voice.whatsappDb;
  if (!db || !fs.existsSync(db)) return { skipped: 'no whatsapp db', added: 0 };
  const { DatabaseSync } = require('node:sqlite');
  const D = sends.dirs(c.dir);
  let cursor = {};
  try { cursor = JSON.parse(fs.readFileSync(D.cursor, 'utf8')); } catch { /* first run */ }
  const since = opts.all ? '' : (cursor.whatsapp || '');
  const conn = new DatabaseSync(db, { readOnly: true });
  let rows;
  try {
    rows = conn.prepare(`SELECT m.id, m.chat_jid, m.content, m.timestamp, c.name AS chat
      FROM messages m LEFT JOIN chats c ON c.jid = m.chat_jid
      WHERE m.is_from_me = 1 AND m.content IS NOT NULL AND m.content != '' AND m.timestamp > ?
      ORDER BY m.timestamp`).all(since);
  } finally { conn.close(); }
  const people = loadPeople(c);
  const names = contactNames(path.join(path.dirname(db), 'whatsapp.db'));
  const self = new Set([].concat(c.identityIds.whatsapp || []).map(String));
  const out = rows.filter((r) => !self.has(String(r.chat_jid).split('@')[0])).map((r) => {
    const group = /@g\.us$/.test(r.chat_jid);
    const chat = r.chat && !/^\d+$/.test(r.chat) ? r.chat : (names.get(String(r.chat_jid).split('@')[0]) || r.chat || r.chat_jid);
    const who = group ? [] : peopleIn(chat, people);
    return { id: 'wa:' + r.id, ts: new Date(String(r.timestamp).replace(' ', 'T')).toISOString(), channel: 'whatsapp', chat, group, to: who[0] || chat, text: r.content };
  });
  const added = sends.add(c.dir, out);
  if (rows.length) {
    cursor.whatsapp = rows[rows.length - 1].timestamp;
    fs.mkdirSync(path.dirname(D.cursor), { recursive: true });
    fs.writeFileSync(D.cursor, JSON.stringify(cursor));
  }
  return { added, read: rows.length };
}

module.exports = { collect };

if (require.main === module) {
  const r = collect({ all: process.argv.includes('--all') });
  console.log(r.skipped ? `whatsapp: ${r.skipped}` : `whatsapp: ${r.added} new sends (${r.read} read)`);
}
