#!/usr/bin/env node
'use strict';
/**
 * Tone, learned once and scored locally.
 *
 *   node tone.js teach [n=500]   a small model labels n of your messages (one time)
 *   node tone.js train           fit the local classifier, report agreement on a held-out 20%
 *   node tone.js recalibrate     label 50 fresh messages; retrain when agreement drops under 80%
 *
 * The bar is on polarity (negative / flat / positive). Fine-grained mood is
 * shown too, but the teacher itself only agrees with its own mood labels
 * about three times in four, so no student can be held to 80% there.
 *
 * Labels and the model live in local.nosync/ because they are built from your words.
 * After training, `node ingest.js --rebuild` scores every message.
 */
const fs = require('fs');
const path = require('path');
const { loadUsageConfig } = require('../config');
const store = require('./store');
const teacher = require('./teacher');
const student = require('./student');
const { collect } = require('./spotcheck');

const BAR = 0.8;

function files(c) {
  const P = store.paths(c.dir);
  return {
    labels: path.join(P.local, 'labels.jsonl'),
    model: P.model,
    evalFile: path.join(c.dir, 'model', 'eval.json'),
    spend: path.join(c.dir, 'model', 'spend.jsonl'),
  };
}

function readJsonl(f) { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } }

/** Your messages with text, deduped, at least two words, newest first. */
function yourMessages() {
  const got = collect(Infinity, 400e6).you;
  const seen = new Set();
  return got.filter((m) => { if (seen.has(m.id) || m.text.split(/\s+/).length < 2) return false; seen.add(m.id); return true; })
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

/** Spread the sample: every tool, and messages with laughs, questions or pushback are kept in. */
function pick(msgs, n, codexShare = 0.15) {
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const codex = shuffle(msgs.filter((m) => m.tool === 'codex')).slice(0, Math.round(n * codexShare));
  const claude = msgs.filter((m) => m.tool === 'claude');
  const signal = shuffle(claude.filter((m) => /\?|!|\b(ha(ha)+|lol|no|wrong|again|ugh|why)\b/i.test(m.text))).slice(0, Math.round(n * 0.35));
  const ids = new Set(signal.map((m) => m.id));
  const rest = shuffle(claude.filter((m) => !ids.has(m.id))).slice(0, n - codex.length - signal.length);
  return [...codex, ...signal, ...rest];
}

function teach(n) {
  const c = loadUsageConfig();
  const F = files(c);
  const have = new Set(readJsonl(F.labels).map((l) => l.id));
  const sample = pick(yourMessages().filter((m) => !have.has(m.id)), n);
  console.log(`tone: labeling ${sample.length} messages (${sample.filter((m) => m.tool === 'codex').length} via codex)`);
  const byId = new Map(sample.map((m) => [m.id, m]));
  const labels = teacher.label(sample, {
    job: 'teach', spendFile: F.spend, codexModel: c.codexModel,
    onBatch: (tool, k) => process.stdout.write(`  ${tool} ${k}\r`),
    onError: (tool, e) => console.error(`\n  ${tool} batch failed: ${e.message.slice(0, 160)}`),
  });
  fs.mkdirSync(path.dirname(F.labels), { recursive: true });
  fs.appendFileSync(F.labels, labels.map((l) => JSON.stringify({ ...l, text: byId.get(l.id).text })).join('\n') + (labels.length ? '\n' : ''));
  console.log(`\ntone: ${labels.length} labels saved`);
}

function split(rows, holdout = 0.2) {
  const test = []; const trainRows = [];
  for (const r of rows) { let h = 0; for (const ch of r.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; (h % 100 < holdout * 100 ? test : trainRows).push(r); }
  return { trainRows, test };
}

function train() {
  const c = loadUsageConfig();
  const F = files(c);
  const rows = readJsonl(F.labels);
  if (rows.length < 50) { console.log('tone: need at least 50 labels, run `node tone.js teach` first'); return null; }
  const { trainRows, test } = split(rows);
  const report = student.evaluate(student.load(student.train(trainRows)), test);
  const model = student.train(rows);
  fs.writeFileSync(F.model, JSON.stringify(model));
  const summary = { at: new Date().toISOString(), labels: rows.length, heldOut: report, bar: BAR, passes: report.polarity.agree >= BAR };
  fs.mkdirSync(path.dirname(F.evalFile), { recursive: true });
  fs.writeFileSync(F.evalFile, JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  return summary;
}

function recalibrate() {
  const c = loadUsageConfig();
  const F = files(c);
  if (!fs.existsSync(F.model)) { console.log('tone: no model yet'); return; }
  const score = student.load(JSON.parse(fs.readFileSync(F.model, 'utf8')));
  const have = new Set(readJsonl(F.labels).map((l) => l.id));
  const fresh = yourMessages().filter((m) => !have.has(m.id)).slice(0, 400);
  const sample = pick(fresh, 50);
  const byId = new Map(sample.map((m) => [m.id, m]));
  const labels = teacher.label(sample, { job: 'recalibrate', spendFile: F.spend, codexModel: c.codexModel });
  const rows = labels.map((l) => ({ ...l, text: byId.get(l.id).text }));
  const r = student.evaluate(score, rows);
  fs.appendFileSync(F.labels, rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
  console.log(`tone: fresh polarity agreement ${r.polarity.agree} (bar ${BAR})`);
  if (r.polarity.agree < BAR) {
    console.log('tone: under the bar, retraining');
    train();
    require('./ingest').ingest({ rebuild: true }); // rescore every message with the new model
  }
}

module.exports = { teach, train, recalibrate, split, files };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'teach') teach(Number(arg) || 500);
  else if (cmd === 'train') train();
  else if (cmd === 'recalibrate') recalibrate();
  else console.log('usage: node tone.js teach [n] | train | recalibrate');
}
