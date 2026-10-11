#!/usr/bin/env node
'use strict';
/**
 * Catch up on new transcript lines, then compute every metric.
 *   node report.js           print a short summary
 *   node report.js --json    print the full metrics JSON
 * The JSON holds words and people, so it is written only to local.nosync/.
 */
const fs = require('fs');
const path = require('path');
const { loadUsageConfig } = require('../config');
const { ingest } = require('./ingest');
const { compute } = require('./metrics');
const store = require('./store');

function build() {
  ingest();
  const c = loadUsageConfig();
  const P = store.paths(c.dir);
  const m = compute(store.readAll(P.events), { terms: store.readAll(P.terms), people: store.readAll(P.people), tones: store.readAll(P.tones) }, c);
  try { m.tone = JSON.parse(fs.readFileSync(path.join(c.dir, 'model', 'eval.json'), 'utf8')); } catch { m.tone = null; }
  m.toneModel = fs.existsSync(P.model) ? 'yours' : 'base';
  // Voice cards, summarized for the page: numbers only.
  m.voice = { cards: [], rules: require('../corrections').active(c.dir) };
  try {
    const dir = path.join(P.local, 'voice');
    for (const x of JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))) {
      const k = JSON.parse(fs.readFileSync(path.join(dir, x.key + '.json'), 'utf8'));
      m.voice.cards.push({ key: x.key, channel: k.channel, to: k.to, group: !!k.group, source: k.source, sends: k.sends, words: k.words.p50, wordsHigh: k.words.p90, split: k.sendsPerBurst.splitShare, greeting: k.greeting, signoff: k.signoff, lower: k.lower, period: k.period, base: k.channel === 'ai' });
    }
  } catch { /* no cards yet */ }
  fs.mkdirSync(P.local, { recursive: true });
  fs.writeFileSync(path.join(P.local, 'metrics.json'), JSON.stringify(m));
  return m;
}

module.exports = { build };

if (require.main === module) {
  const m = build();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(m, null, 1)); return; }
  const y = m.you;
  console.log(`${y.prompts} prompts, ${y.words} words, ${y.sessions} sessions, ${y.activeDays} active days (${m.range.from} to ${m.range.to})`);
  console.log(`streak ${y.streak.current} now, ${y.streak.longest} longest; ~${y.session.hours}h active`);
  console.log('top projects:', m.projects.slice(0, 6).map((p) => `${p.name} ${Math.round(p.minutes / 60)}h/${p.prompts}`).join(', '));
  console.log('cost you/os:', m.machine.layers.you.cost, m.machine.layers.os.cost);
  for (const d of m.contexts.diffs.slice(0, 8)) console.log(' -', d.text);
}
