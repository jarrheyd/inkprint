#!/usr/bin/env node
'use strict';
/**
 * Nightly rollup. Writes plain files a person can read or grep:
 *   days/YYYY-MM-DD.md   the day's numbers + a 3-line read
 *   weeks/YYYY-Www.md    the week's numbers + where you differed by context
 *   profile.md           rolling style profile, refreshed once a week
 *   dashboard.html       static snapshot of the live page
 * The model read gets numbers and, for the day read only, 5 of your Claude
 * messages as context. No names of people go in, and the reads never quote.
 *
 *   node rollup.js [--no-model] [--day YYYY-MM-DD]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadUsageConfig } = require('../config');
const { ingest } = require('./ingest');
const { compute, isoWeek, localParts } = require('./metrics');
const store = require('./store');
const { collect } = require('./spotcheck');

function pct(x) { return `${Math.round((x || 0) * 100)}%`; }
function hours(m) { return m < 6 ? '<0.1' : (m / 60).toFixed(1); }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function numbers(m) {
  const y = m.you; const b = m.words.base;
  const moods = b.moods ? Object.entries(b.moods).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(', ') : 'n/a';
  return [
    `messages: ${y.prompts}`, `words: ${y.words}`, `sessions: ${y.sessions}`,
    `active hours: ${hours(m.projects.reduce((a, p) => a + p.minutes, 0))}`,
    `typical message: ${b.medianWords} words`, `push back: ${pct(b.correction)}`, `questions: ${pct(b.question)}`,
    `laughs: ${pct(b.laugh)}`, `late night: ${pct(b.late)}`, `mood mix: ${moods}`,
    b.valence != null ? `mood score: ${b.valence}` : null,
    `projects: ${m.projects.slice(0, 5).map((p) => `${p.name} ${hours(p.minutes)}h`).join(', ')}`,
    `api-equivalent cost: you $${m.machine.layers.you.cost}, os $${m.machine.layers.os.cost}`,
  ].filter(Boolean);
}

function frontmatter(obj) {
  return '---\n' + Object.entries(obj).map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)}`).join('\n') + '\n---\n';
}

const STYLE = `Write like a friend reading the numbers back out loud: short sentences, plain everyday words, second person ("you"), numbers where they help.
Hard rules: no dashes of any kind between clauses, no semicolons, no "not X but Y" or "X, not Y" contrasts, no words like suggests, signals, dominates, intensified, sprint, rhythm, landscape. No names of people, no quotes from messages, no advice, no praise.`;

const READ_SYSTEM = `You write a read of one person's day with their AI tools, from their own usage numbers.
${STYLE}
Exactly three sentences, each under 20 words. Say how the day went: pace, what they worked on, mood, where they pushed back. If the numbers are thin, say less.`;

const PROFILE_SYSTEM = `You describe how one person works with AI tools, from their usage numbers only.
${STYLE}
Exactly five lines, each one sentence under 22 words, each starting with "- ". Cover: when they work, how they give instructions, how they react when things go wrong, how they shift by time of day or project, what changed in the last 4 weeks.`;

/** Backstop for the style rules: models still slip in long dashes. */
function tidy(text) {
  return String(text || '').replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/;\s*/g, '. ').replace(/ ,/g, ',').replace(/\. ([a-z])/g, (_, ch) => '. ' + ch.toUpperCase()).replace(/\n\s*\n(?=- )/g, '\n').trim();
}

function modelRead(system, input, c, spendFile) {
  const out = execFileSync('claude', [
    '-p', '--model', 'haiku', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
    '--settings', '{"disableAllHooks":true,"alwaysThinkingEnabled":false}', '--tools', '', '--system-prompt', system, '--output-format', 'json',
  ], { input, cwd: os.tmpdir(), encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  const d = JSON.parse(out);
  if (d.is_error) throw new Error(String(d.result).slice(0, 200));
  const u = Object.values(d.modelUsage || {})[0] || {};
  fs.mkdirSync(path.dirname(spendFile), { recursive: true });
  fs.appendFileSync(spendFile, JSON.stringify({ ts: new Date().toISOString(), tool: 'claude', job: 'read', in: (u.inputTokens || 0) + (u.cacheCreationInputTokens || 0) + (u.cacheReadInputTokens || 0), out: u.outputTokens || 0 }) + '\n');
  return tidy(d.result);
}

function rollup(opts = {}) {
  // A failed read of new transcripts should never cost you the report: build from what's already saved.
  try { ingest(); } catch (e) { console.error(`inkprint: reading new transcripts failed (${e.message}); building from what is already saved.`); }
  try { require('../voice/build').build(); } catch { /* voice cards are optional */ }
  const c = loadUsageConfig();
  const P = store.paths(c.dir);
  const parts = localParts(c.timezone);
  const events = store.readAll(P.events);
  const local = { terms: store.readAll(P.terms), people: store.readAll(P.people), tones: store.readAll(P.tones) };
  const spendFile = path.join(c.dir, 'model', 'spend.jsonl');
  const useModel = c.model && !opts.noModel;
  const today = opts.day || parts(new Date().toISOString()).day;
  const dayOf = new Map(events.map((e) => [e.id, parts(e.ts).day]));
  const written = [];

  // Days: today always, plus any past day with no file yet (numbers only).
  const dayDir = path.join(c.dir, 'days');
  fs.mkdirSync(dayDir, { recursive: true });
  const allDays = [...new Set(events.filter((e) => e.kind === 'prompt' && e.layer === 'you').map((e) => dayOf.get(e.id)))].sort();
  for (const day of allDays) {
    const file = path.join(dayDir, day + '.md');
    if (day !== today && fs.existsSync(file)) continue;
    const evs = events.filter((e) => dayOf.get(e.id) === day);
    const m = compute(evs, local, c);
    if (!m.you.prompts) continue;
    let read = '';
    if (useModel && day === today && m.you.prompts >= 5) {
      let quotes = [];
      try {
        const ids = new Set(evs.filter((e) => e.kind === 'prompt' && e.layer === 'you' && e.tool === 'claude').map((e) => e.id));
        quotes = collect(Infinity, 400e6).you.filter((q) => ids.has(q.id) && q.text.split(/\s+/).length >= 4).slice(-5).map((q) => q.text.replace(/\s+/g, ' ').slice(0, 200));
      } catch { /* numbers alone are fine */ }
      try { read = modelRead(READ_SYSTEM, `Numbers for ${day}:\n${numbers(m).join('\n')}\n\nFive of their messages, for tone only (do not quote or name anyone):\n${quotes.map((q) => '- ' + q).join('\n')}`, c, spendFile); } catch (e) { read = ''; }
    }
    const top = m.projects.slice(0, 5).map((p) => ({ name: p.name, hours: hours(p.minutes), messages: p.prompts }));
    const body = frontmatter({ day, messages: m.you.prompts, words: m.you.words, sessions: m.you.sessions, valence: m.words.base.valence ?? null, pushBack: m.words.base.correction, costYou: m.machine.layers.you.cost, costOs: m.machine.layers.os.cost })
      + `\n# ${day}\n\n` + (read ? read + '\n\n' : '') + numbers(m).map((l) => `- ${l}`).join('\n') + '\n\n'
      + (top.length ? '## Projects\n\n' + top.map((p) => `- ${p.name}: ${p.hours}h, ${plural(p.messages, 'message', 'messages')}`).join('\n') + '\n' : '');
    store.busyRetry(() => fs.writeFileSync(file, body));
    written.push(file);
  }

  // Weeks: current week always, past weeks once.
  const weekDir = path.join(c.dir, 'weeks');
  fs.mkdirSync(weekDir, { recursive: true });
  const thisWeek = isoWeek(today);
  for (const wk of [...new Set(allDays.map(isoWeek))]) {
    const file = path.join(weekDir, wk + '.md');
    if (wk !== thisWeek && fs.existsSync(file)) continue;
    const evs = events.filter((e) => isoWeek(dayOf.get(e.id)) === wk);
    const m = compute(evs, local, c);
    const diffs = m.contexts.combined.filter((d) => d.kind === 'project').slice(0, 6); // people stay local
    fs.writeFileSync(file, frontmatter({ week: wk, messages: m.you.prompts, words: m.you.words, activeDays: m.you.activeDays, valence: m.words.base.valence ?? null })
      + `\n# ${wk}\n\n` + numbers(m).map((l) => `- ${l}`).join('\n') + '\n'
      + (diffs.length ? '\n## Where you differed\n\n' + diffs.map((d) => `- ${d.text}`).join('\n') + '\n' : ''));
    written.push(file);
  }

  // Profile: weekly (or when missing). Built from numbers only.
  const profileFile = path.join(c.dir, 'profile.md');
  let age = Infinity;
  try { age = Date.now() - fs.statSync(profileFile).mtimeMs; } catch { /* first run */ }
  if (age > 6.5 * 864e5 || opts.profile) {
    const m = compute(events, local, c);
    const recent = compute(events.filter((e) => Date.parse(e.ts) > Date.now() - 28 * 864e5), local, c);
    const tp = m.words.timeProfiles;
    const lines = [
      ...numbers(m),
      `last 4 weeks: ${numbers(recent).join('; ')}`,
      ...Object.entries(tp).map(([k, p]) => `${k}: ${p.n} messages, typical ${p.medianWords} words, push back ${pct(p.correction)}, questions ${pct(p.question)}${p.valence != null ? `, mood ${p.valence}` : ''}`),
      `phrases you use most: ${m.words.bigrams.slice(0, 12).map((b) => b[0]).join(', ')}`,
      ...m.contexts.combined.filter((d) => d.kind === 'project').slice(0, 8).map((d) => d.text),
    ];
    let read = '';
    if (useModel) {
      try {
        read = modelRead(PROFILE_SYSTEM, lines.join('\n'), c, spendFile);
      } catch { read = ''; }
    }
    fs.writeFileSync(profileFile, frontmatter({ updated: today, messages: m.you.prompts, since: m.range.from })
      + '\n# How you work with AI\n\n' + (read ? read + '\n\n' : '') + '## Numbers behind it\n\n' + lines.map((l) => `- ${l}`).join('\n') + '\n');
    written.push(profileFile);
  }

  // Static snapshot of the dashboard, with the metrics baked in. Local only: it names people.
  try {
    const page = fs.readFileSync(path.join(__dirname, '..', '..', 'page', 'index.html'), 'utf8');
    const m = compute(events, local, c);
    const snap = page.replace('<script>', `<script>window.__SNAPSHOT__ = ${JSON.stringify(m).replace(/</g, '\\u003c')};\n`);
    fs.mkdirSync(P.local, { recursive: true });
    fs.writeFileSync(path.join(P.local, 'dashboard.html'), snap);
    written.push(path.join(P.local, 'dashboard.html'));
  } catch { /* page missing */ }
  return written;
}

module.exports = { rollup, numbers, tidy };

if (require.main === module) {
  const a = process.argv.slice(2);
  const i = a.indexOf('--day');
  const w = rollup({ noModel: a.includes('--no-model'), day: i >= 0 ? a[i + 1] : undefined, profile: a.includes('--profile') });
  console.log(`usage rollup: wrote ${w.length} files`);
}
