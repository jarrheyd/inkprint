'use strict';
/**
 * Your sent messages, one JSONL file per channel, kept in the local-only
 * store (text never syncs). Rows: { id, ts, channel, chat, to, text }.
 * `to` is a person from the people file when the chat is one-to-one,
 * otherwise the chat or group name.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHANNELS = ['whatsapp', 'telegram', 'discord', 'email', 'gchat', 'teams'];

function dirs(usageDir) {
  const base = path.join(usageDir, 'local.nosync');
  return { sends: path.join(base, 'sends'), inbox: path.join(base, 'sends', 'inbox.jsonl'), cards: path.join(base, 'voice'), cursor: path.join(base, 'sends', 'cursor.json') };
}

/** Same message from two sources (local db, a harvested tool result, a backfill) gets one id: channel + words + minute. */
function idOf(r) {
  const words = String(r.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return crypto.createHash('sha1').update([r.channel, words, String(r.ts || '').slice(0, 16)].join('\u0000')).digest('hex').slice(0, 16);
}

function read(usageDir, channel) {
  const f = path.join(dirs(usageDir).sends, channel + '.jsonl');
  const byId = new Map();
  let txt = '';
  try { txt = fs.readFileSync(f, 'utf8'); } catch { return []; }
  for (const line of txt.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); byId.set(r.id, r); } catch { /* torn line */ }
  }
  return [...byId.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

/** Messages your AI sent or drafted for you, remembered so they never count as your voice. */
function aiKey(text) { return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120); }
function aiFile(usageDir) { return path.join(dirs(usageDir).sends, 'ai-sent.json'); }
function aiSent(usageDir) { try { return new Set(JSON.parse(fs.readFileSync(aiFile(usageDir), 'utf8'))); } catch { return new Set(); } }
function rememberAi(usageDir, texts) {
  if (!texts.length) return;
  const set = aiSent(usageDir);
  for (const t of texts) { const k = aiKey(t); if (k.length >= 8) set.add(k); }
  fs.mkdirSync(dirs(usageDir).sends, { recursive: true });
  fs.writeFileSync(aiFile(usageDir), JSON.stringify([...set]));
}
function isAi(set, text) {
  const k = aiKey(text);
  if (set.has(k)) return true;
  for (const a of set) if (k.length >= 40 && (a.startsWith(k.slice(0, 60)) || k.startsWith(a.slice(0, 60)))) return true;
  return false;
}

/** Append rows not already stored; returns how many were new. */
function add(usageDir, rows) {
  const D = dirs(usageDir);
  fs.mkdirSync(D.sends, { recursive: true });
  const byChannel = {};
  for (const r of rows) {
    if (!r || !CHANNELS.includes(r.channel) || !r.text || !String(r.text).trim()) continue;
    (byChannel[r.channel] = byChannel[r.channel] || []).push({ ...r, id: idOf(r), text: String(r.text) });
  }
  let added = 0;
  for (const [ch, list] of Object.entries(byChannel)) {
    const have = new Set(read(usageDir, ch).map((r) => r.id));
    const fresh = list.filter((r) => (have.has(r.id) ? false : (have.add(r.id), true)));
    if (!fresh.length) continue;
    fs.appendFileSync(path.join(D.sends, ch + '.jsonl'), fresh.map((r) => JSON.stringify(r)).join('\n') + '\n');
    added += fresh.length;
  }
  return added;
}

/** Move lines agents wrote to inbox.jsonl into the channel files. */
function drainInbox(usageDir) {
  const D = dirs(usageDir);
  let txt = '';
  try { txt = fs.readFileSync(D.inbox, 'utf8'); } catch { return 0; }
  const rows = [];
  for (const line of txt.split('\n')) { if (!line.trim()) continue; try { rows.push(JSON.parse(line)); } catch { /* skip */ } }
  const n = add(usageDir, rows.map((r) => ({ ...r, channel: String(r.channel || '').toLowerCase().replace(/^gmail$/, 'email').replace(/^google ?chat$/, 'gchat') })));
  fs.writeFileSync(D.inbox, '');
  return n;
}

module.exports = { CHANNELS, dirs, read, add, drainInbox, idOf, aiSent, rememberAi, isAi };
