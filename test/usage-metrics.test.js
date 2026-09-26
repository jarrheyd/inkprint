'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const U = path.join(path.resolve(__dirname, '..'), 'lib', 'usage');
const { features, proseOf } = require(path.join(U, 'features'));
const { parsePeople, loadPeople, peopleIn, projectOf, loadProjects, projectsIn } = require(path.join(U, 'entities'));
const { compute, priceFor, costOf } = require(path.join(U, 'metrics'));

test('features: counts, particles, languages, corrections', () => {
  const f = features('no, wrong again hahaha sige ra, fix it', { particles: ['ra', 'sige'], languages: { Bisaya: ['sige', 'ra'] } });
  assert.strictEqual(f.stats.correction, 1);
  assert.strictEqual(f.stats.laugh, 1);
  assert.deepStrictEqual(f.stats.particles, { ra: 1, sige: 1 });
  assert.deepStrictEqual(f.stats.langs, { Bisaya: 2 });
  assert.strictEqual(features('can you check the header?').stats.question, 1);
  assert.strictEqual(features('THIS IS STILL BROKEN').stats.shout, 1);
  assert.strictEqual(features('update the SOW and the QA doc').stats.shout, 0);
});

test('features: pasted code, logs and links stay out of word stats', () => {
  assert.strictEqual(proseOf('fix login pls\nhttps://x.co/a\n{"a": 1}\n0x1f symbolLocation imageOffset'), 'fix login pls');
  const f = features('i think the invite page\n"imageOffset": 12345,');
  assert.ok(f.terms.includes('invite'));
  assert.ok(!f.terms.includes('imageoffset'));
  assert.ok(f.bigrams.includes('i think'));
  assert.ok(!f.bigrams.some((b) => b.endsWith(' the')));
});

test('entities: people table formats and aliases', () => {
  const md = [
    '## Team', '| Person | Role | Notes |', '|---|---|---|',
    '| Dana (Dana Cruz) | CEO | x |', '| Lee / L | Sales | y |', '| Ana Reyes (ana@x.co) | BA | z |',
    '', '| Person | How I write to them |', '|---|---|', '| Nobody | casual |',
    '## Kim Park - former PM',
  ].join('\n');
  const names = parsePeople(md).map((p) => p.name);
  assert.deepStrictEqual(names, ['Dana', 'Lee', 'Ana Reyes', 'Kim Park']);
  const idx = loadPeople({ peopleFile: '', aliases: { Lee: ['Leo'] } });
  assert.deepStrictEqual(peopleIn('ask leo', idx), ['Lee']);
});

test('entities: projects from folders, aliases and mentions', () => {
  const c = { projectPaths: { '/work/client/acme': 'Acme' }, projects: [{ key: 'beta', label: 'Beta App' }], projectAliases: { Gamma: ['gam'] } };
  assert.strictEqual(projectOf('/work/client/acme/.claude/worktrees/x', c), 'Acme');
  assert.strictEqual(projectOf('/work/tools/.claude/worktrees/feat', c), 'tools');
  assert.strictEqual(projectOf('/private/tmp/abc', c), '(scratch)');
  const idx = loadProjects(c);
  assert.deepStrictEqual(projectsIn('the beta app build and gam', idx).sort(), ['Beta App', 'Gamma']);
});

test('metrics: prices and cost', () => {
  assert.deepStrictEqual(priceFor('claude-opus-5[1m]'), { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 });
  assert.strictEqual(priceFor('claude-opus-5-5').cacheRead, 0.2);
  assert.strictEqual(priceFor('gpt-x'), null);
  assert.strictEqual(priceFor('gpt-x', { 'gpt-x': { in: 1, out: 2 } }).out, 2);
  assert.strictEqual(costOf({ model: 'claude-haiku-4-5', in: 1e6, out: 1e6, cacheRead: 0, cacheWrite: 0 }), 6);
});

function ev(id, ts, extra) { return { id, ts, kind: 'prompt', layer: 'you', tool: 'claude', session: 's1', project: '/work/acme', words: 10, ...extra }; }

test('metrics: streaks, hub projects, context diffs, OS split', () => {
  const day = (d, h = '03') => `2026-09-${d}T${h}:00:00Z`;
  const events = [];
  for (let i = 0; i < 30; i++) events.push(ev('a' + i, day('0' + (1 + (i % 3)), String(i % 10).padStart(2, '0')), { correction: i % 2 }));
  for (let i = 0; i < 30; i++) events.push(ev('h' + i, day('05'), { session: 'hub', project: '/vault', about: ['Beta App'] }));
  for (let i = 0; i < 30; i++) events.push(ev('g' + i, day('06'), { session: 'gen', project: '/vault' }));
  events.push({ id: 'o1', ts: day('05'), kind: 'prompt', layer: 'os', tool: 'claude', session: 'job', project: '/vault', sessionLayer: 'os', words: 99 });
  events.push({ id: 'm1', ts: day('05'), kind: 'model', tool: 'claude', session: 'job', sessionLayer: 'os', model: 'claude-haiku-4-5', in: 1e6, out: 0, cacheRead: 0, cacheWrite: 0, calls: 3 });
  events.push({ id: 't1', ts: day('05'), kind: 'tool', tool: 'claude', session: 's1', sessionLayer: 'you', tools: { Read: 4 } });
  const c = { timezone: 'UTC', hubPaths: ['/vault'], projects: [{ key: 'beta', label: 'Beta App' }] };
  const m = compute(events, { terms: [], people: [] }, c);
  assert.strictEqual(m.you.prompts, 90, 'OS prompts are not yours');
  assert.strictEqual(m.you.streak.longest, 3);
  const names = m.projects.map((p) => p.name).sort();
  assert.deepStrictEqual(names, ['Beta App', 'Day to day', 'acme']);
  assert.strictEqual(m.projects[m.projects.length - 1].name, 'Day to day', 'day to day sits last');
  assert.ok(!m.contexts.combined.some((x) => x.name === 'Day to day'), 'running your day is not compared like a project');
  assert.ok(m.contexts.diffs.some((d) => d.name === 'acme' && d.metric === 'correction' && d.lift > 1.6), 'acme pushes back more than baseline');
  const acme = m.contexts.combined.filter((x) => x.name === 'acme');
  assert.strictEqual(acme.length, 1, 'one line per context');
  assert.match(acme[0].text, /^On acme, you push back more \(50% vs \d+%\)/);
  assert.strictEqual(m.machine.layers.os.cost, 1);
  assert.strictEqual(m.machine.layers.os.calls, 3);
  assert.deepStrictEqual(m.machine.tools.you, [['Read', 4]]);
  assert.strictEqual(m.machine.osPrompts, 1);
});
