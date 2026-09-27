#!/usr/bin/env node
'use strict';
/**
 * Incremental ingest. Reads only the bytes each transcript gained since the
 * last run (offsets in cursor.json), turns them into events, and appends.
 * The first run backfills everything on disk. Safe to run as often as you
 * like; the dashboard server calls it on every file change.
 *
 *   node ingest.js            incremental
 *   node ingest.js --rebuild  wipe events + cursor, re-read everything
 */
const fs = require('fs');
const path = require('path');
const { loadUsageConfig } = require('../config');
const claude = require('./parse-claude');
const codex = require('./parse-codex');
const { features } = require('./features');
const { loadPeople, peopleIn, loadProjects, projectsIn } = require('./entities');
const store = require('./store');
const student = require('./student');
const harvest = require('../harvest');
const sends = require('../voice/sends');
const corrections = require('../corrections');

const CHUNK = 8 * 1024 * 1024;

function walk(dir, out, depth = 0) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 6) walk(p, out, depth + 1); }
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function sources(c) {
  const list = [];
  for (const f of walk(c.claudeDir, [])) list.push({ file: f, tool: 'claude', subagent: f.includes(`${path.sep}subagents${path.sep}`) });
  for (const d of c.codexDirs) for (const f of walk(d, [])) list.push({ file: f, tool: 'codex' });
  return list;
}

/** Stream complete lines from `offset` to `onLine`; returns the offset just past the last newline. */
function readNewLines(file, offset, size, onLine) {
  const fd = fs.openSync(file, 'r');
  let pos = offset; let carry = Buffer.alloc(0);
  try {
    while (pos < size) {
      const len = Math.min(CHUNK, size - pos);
      const chunk = Buffer.alloc(len);
      fs.readSync(fd, chunk, 0, len, pos);
      pos += len;
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const cut = buf.lastIndexOf(0x0a);
      if (cut === -1) { carry = buf; continue; }
      let start = 0;
      while (start < cut) {
        const nl = buf.indexOf(0x0a, start);
        if (nl > start) onLine(buf.toString('utf8', start, nl));
        start = nl + 1;
      }
      carry = Buffer.from(buf.subarray(cut + 1));
    }
  } finally { fs.closeSync(fd); }
  return size - carry.length;
}

/** One ingest at a time (live page + nightly job). A lock older than 10 minutes is stale. */
function lock(dir) {
  const f = path.join(dir, '.ingest.lock');
  fs.mkdirSync(dir, { recursive: true });
  try { if (Date.now() - fs.statSync(f).mtimeMs > 10 * 60000) fs.rmSync(f, { force: true }); } catch { /* no lock */ }
  try { fs.writeFileSync(f, String(process.pid), { flag: 'wx' }); return () => fs.rmSync(f, { force: true }); } catch { return null; }
}

function ingest(opts = {}) {
  const c = loadUsageConfig();
  const P = store.paths(c.dir);
  const release = lock(c.dir);
  if (!release) return { filesRead: 0, events: 0, dir: c.dir, skipped: 'locked' };
  try { return run(c, P, opts); } finally { release(); }
}

function run(c, P, opts) {
  // A rebuild re-reads what is on disk. Claude Code deletes old transcripts, so
  // rows older than anything still on disk are kept, not thrown away.
  let kept = null;
  if (opts.rebuild) {
    kept = {};
    for (const k of ['events', 'terms', 'people', 'tones']) { kept[k] = store.readAll(P[k]); fs.rmSync(P[k], { recursive: true, force: true }); }
    fs.rmSync(P.cursor, { force: true });
  }
  let cursor = { version: 1, files: {} };
  try { cursor = JSON.parse(fs.readFileSync(P.cursor, 'utf8')); } catch { /* first run */ }

  let score = null;
  // Your own tuned model if you made one, else the base model inkprint ships.
  for (const f of [P.model, path.join(__dirname, '..', '..', 'models', 'base-tone.json')]) {
    try { score = student.load(JSON.parse(fs.readFileSync(f, 'utf8'))); break; } catch { /* try the next */ }
  }
  const tones = [];
  const people = loadPeople(c);
  // Who "you" are in chat tools: full name, extra names from config, "me", your emails, your Discord id.
  const self = {
    names: new Set([c.fullName, ...c.selfNames, 'me'].filter(Boolean).map((x) => String(x).toLowerCase())),
    emails: new Set(c.emails),
    discordIds: new Set([].concat(((c.identityIds || {}).discord || {}).authorId || []).map(String)),
  };
  const hopts = {
    ...c.classifyOpts,
    onToolUse: (name, input) => harvest.learnFromInput(name, input, self),
    onToolResult: (name, input, text) => harvest.harvest(name, input, text, self),
  };
  const harvested = [];
  const replies = []; // your replies to drafts the AI wrote: where your voice rules come from
  const aiTexts = [];
  const { bodyOf } = require('../voice/hook');
  hopts.sendTool = harvest.SEND_TOOL;
  hopts.onAiSend = (input) => { const t = bodyOf(input || {}); if (t) aiTexts.push(t); };
  const projectIndex = loadProjects(c);
  const events = []; const terms = []; const tags = [];
  let filesRead = 0; let total = 0;
  for (const s of sources(c)) {
    let st;
    try { st = fs.statSync(s.file); } catch { continue; }
    const prev = cursor.files[s.file] || { offset: 0, state: { subagent: !!s.subagent } };
    if (st.size < prev.offset) { prev.offset = 0; prev.state = { subagent: !!s.subagent }; } // rewritten
    if (st.size === prev.offset) continue;
    filesRead++;
    // Model calls are summed per session + hour, tool calls per session + day; prompts stay one row each.
    const agg = new Map();
    const seenMsg = new Set();
    let n = 0;
    const next = readNewLines(s.file, prev.offset, st.size, (line) => {
      n++;
      let d;
      try { d = JSON.parse(line); } catch { return; }
      const evs = s.tool === 'claude'
        ? claude.parseRecord(d, prev.state, hopts)
        : codex.parseRecord(d, prev.state, hopts, `${prev.offset}:${n}`);
      for (const ev of evs) {
        if (ev.kind === 'harvest') { for (const r of ev.rows) if (r.ts || ev.ts) harvested.push({ ...r, ts: r.ts || ev.ts }); continue; }
        if (!ev.id || !ev.ts) continue;
        if (ev.kind === 'prompt') {
          const f = features(ev.text, c);
          Object.assign(ev, f.stats);
          const about = projectsIn(ev.text, projectIndex);
          if (about.length) ev.about = about;
          if (ev.layer === 'you' && f.terms.length) terms.push({ id: ev.id, ts: ev.ts, terms: f.terms, bigrams: f.bigrams });
          if (ev.layer === 'you' && ev.afterDraft) replies.push({ id: ev.id, ts: ev.ts, text: ev.text });
          const who = ev.layer === 'you' ? peopleIn(ev.text, people) : [];
          if (who.length) tags.push({ id: ev.id, ts: ev.ts, people: who });
          if (score && ev.layer === 'you') tones.push({ id: ev.id, ts: ev.ts, ...score(ev.text) });
          delete ev.text;
          events.push(ev);
          continue;
        }
        if (ev.kind === 'model') { if (seenMsg.has(ev.id)) continue; seenMsg.add(ev.id); }
        const hour = ev.kind === 'model' ? ev.ts.slice(0, 13) : ev.ts.slice(0, 10) + 'T00';
        const name = ev.kind === 'model' ? ev.model : 'all';
        const key = `${ev.kind}|${ev.session}|${name}|${hour}`;
        let a = agg.get(key);
        if (!a) {
          a = { id: `${ev.kind === 'model' ? 'm' : 't'}:${ev.session}:${name}:${hour}:${prev.offset}`, ts: hour + ':00:00Z',
            tool: ev.tool, session: ev.session, project: ev.project, kind: ev.kind, sessionLayer: ev.sessionLayer, calls: 0 };
          if (ev.kind === 'model') Object.assign(a, { model: ev.model, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 });
          else a.tools = {};
          agg.set(key, a);
        }
        a.calls++;
        if (ev.kind === 'tool') a.tools[ev.name] = (a.tools[ev.name] || 0) + 1;
        if (ev.kind === 'model') { a.in += ev.in; a.out += ev.out; a.cacheRead += ev.cacheRead; a.cacheWrite += ev.cacheWrite; }
      }
      if (events.length > 20000) { total += events.length; store.appendGrouped(P.events, events.splice(0)); store.appendGrouped(P.terms, terms.splice(0)); store.appendGrouped(P.people, tags.splice(0)); store.appendGrouped(P.tones, tones.splice(0)); }
    });
    for (const a of agg.values()) events.push(a);
    cursor.files[s.file] = { offset: next, state: prev.state };
  }
  total += events.length;
  store.appendGrouped(P.events, events);
  store.appendGrouped(P.terms, terms);
  store.appendGrouped(P.people, tags);
  store.appendGrouped(P.tones, tones);
  sends.rememberAi(c.dir, aiTexts);
  corrections.record(c.dir, replies);
  const ai = sends.aiSent(c.dir);
  const harvestedNew = harvested.length ? sends.add(c.dir, harvested.filter((r) => !sends.isAi(ai, r.text))) : 0;
  if (kept) {
    const fresh = store.readAll(P.events).filter((e) => e.kind === 'prompt').map((e) => e.ts).sort();
    const floor = fresh[0] || '9999';
    for (const k of ['events', 'terms', 'people', 'tones']) store.appendGrouped(P[k], kept[k].filter((r) => r.ts && r.ts < floor));
  }
  fs.mkdirSync(c.dir, { recursive: true });
  store.busyRetry(() => fs.writeFileSync(P.cursor, JSON.stringify(cursor)));
  return { filesRead, events: total, harvested: harvestedNew, dir: c.dir };
}

module.exports = { ingest, readNewLines, sources };

if (require.main === module) {
  const t0 = Date.now();
  const r = ingest({ rebuild: process.argv.includes('--rebuild') });
  console.log(`usage ingest: ${r.events} events from ${r.filesRead} files in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${r.dir}`);
}
