#!/usr/bin/env node
'use strict';
/**
 * Build the base mood model that ships in models/base-tone.json.
 * A small model writes and labels synthetic messages (never anyone's real
 * ones) across contexts, styles and moods; the local classifier learns them.
 *
 *   node scripts/make-base-model.js generate [batches=36] [start=0]   appends to scripts/corpus.jsonl
 *   node scripts/make-base-model.js train                     writes models/base-tone.json
 * Not part of the package; run by maintainers only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { MOODS, REGISTERS, TARGETS, SYSTEM: LABEL_RULES } = require('../lib/usage/teacher');

const CORPUS = path.join(__dirname, 'corpus.jsonl');
const OUT = path.join(__dirname, '..', 'models', 'base-tone.json');

const CONTEXTS = [
  'a developer prompting an AI coding agent in a terminal (bugs, refactors, tests, deploys)',
  'an operator or founder prompting an AI assistant about email, docs, meetings and planning',
  'a product manager prompting an AI about tickets, specs, sprint planning and user feedback',
  'a designer prompting an AI about UI, layouts, copy and visual polish',
  'short replies to an AI right after it answered (approvals, pushback, follow-ups)',
  'a team lead messaging teammates in a work chat (Slack, Discord, Teams)',
  'someone emailing a client or partner about a project',
  'a freelancer messaging a client on WhatsApp or Telegram',
];
const STYLES = [
  'all lowercase, terse, few words, no punctuation',
  'normal casing, direct and plain',
  'polished full sentences, formal',
  'casual with typos and abbreviations (pls, thx, u, rn)',
  'mixes English with another language the way bilingual professionals do (Taglish, Spanglish, Hinglish, or similar), light touch',
  'expressive, uses laughing like haha or lol and the odd emoji',
];

function batchPrompt(i) {
  const ctx = CONTEXTS[i % CONTEXTS.length];
  const style = STYLES[Math.floor(i / CONTEXTS.length) % STYLES.length];
  const lean = MOODS[i % MOODS.length];
  return `Write 90 realistic, varied messages from: ${ctx}. Writing style: ${style}.
Spread the moods so every one of ${MOODS.join(', ')} appears, with extra "${lean}" and plenty of plain focused/neutral ones like real usage. Vary length from 1 word to 60 words. No names of real companies or people; invent them. Each message stands alone.
Then label each message exactly as the rules below describe.

${LABEL_RULES}`;
}

const SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'mood', 'valence', 'register', 'target'],
    properties: { text: { type: 'string' }, mood: { type: 'string', enum: MOODS }, valence: { type: 'number' }, register: { type: 'string', enum: REGISTERS }, target: { type: 'string', enum: TARGETS } } } } },
  required: ['items'], additionalProperties: false,
};

function generate(batches, start = 0) {
  let tokens = 0;
  for (let i = start; i < start + batches; i++) {
    let d;
    try {
      const out = execFileSync('claude', ['-p', '--model', 'haiku', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
        '--settings', '{"disableAllHooks":true,"alwaysThinkingEnabled":false}', '--tools', '', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA)],
      { input: batchPrompt(i), cwd: os.tmpdir(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600000 });
      d = JSON.parse(out);
    } catch (e) { console.error(`batch ${i} failed: ${String(e.message).slice(0, 120)}`); continue; }
    const items = ((d.structured_output || {}).items || []).filter((x) => x.text && MOODS.includes(x.mood));
    const u = Object.values(d.modelUsage || {})[0] || {};
    tokens += (u.inputTokens || 0) + (u.cacheCreationInputTokens || 0) + (u.cacheReadInputTokens || 0) + (u.outputTokens || 0);
    fs.appendFileSync(CORPUS, items.map((x, k) => JSON.stringify({ id: `syn-${i}-${k}`, ...x })).join('\n') + '\n');
    console.log(`batch ${i}: +${items.length} (tokens so far ${tokens})`);
  }
}

// Rough proportions in real use: most messages to an AI are flat and focused. Only the mood heads are
// shifted; register and target depend too much on the person to guess.
const REAL_PRIOR = {
  polarity: { flat: 0.75, neg: 0.18, pos: 0.07 },
  mood: { focused: 0.45, curious: 0.18, frustrated: 0.13, neutral: 0.13, pleased: 0.05, stressed: 0.04, playful: 0.02 },
};

function adjust(model, rows) {
  const pol = (m) => ({ frustrated: 'neg', stressed: 'neg', pleased: 'pos', playful: 'pos' })[m] || 'flat';
  for (const [h, target] of Object.entries(REAL_PRIOR)) {
    const head = model.heads[h];
    const counts = head.classes.map((k) => rows.filter((r) => (h === 'polarity' ? pol(r.mood) : r[h]) === k).length + 1);
    const total = counts.reduce((a, b) => a + b, 0);
    head.adj = head.classes.map((k, i) => Math.round(Math.log((target[k] || 0.01) / (counts[i] / total)) * 1000) / 1000);
  }
  // Only call a message tense or upbeat when fairly sure; otherwise it's plain.
  model.heads.polarity.minConf = 0.6;
  model.heads.polarity.fallback = 'flat';
  return model;
}

function train() {
  const student = require('../lib/usage/student');
  const rows = fs.readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const hash = (id) => { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 100; };
  const test = rows.filter((r) => hash(r.id) < 20); const trainRows = rows.filter((r) => hash(r.id) >= 20);
  const held = student.evaluate(student.load(adjust(student.train(trainRows), trainRows)), test);
  const model = adjust(student.train(rows), rows);
  model.base = true;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(model));
  console.log(JSON.stringify({ rows: rows.length, heldOut: held, bytes: fs.statSync(OUT).size }, null, 1));
  const real = process.argv[3];
  if (real && fs.existsSync(real)) {
    const labels = fs.readFileSync(real, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    console.log('on real labeled messages:', JSON.stringify(student.evaluate(student.load(model), labels)));
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'generate') generate(Number(arg) || 36, Number(process.argv[4]) || 0);
else if (cmd === 'train') train();
else console.log('usage: node scripts/make-base-model.js generate [batches] | train [real-labels.jsonl]');
