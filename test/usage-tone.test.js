'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const U = path.join(path.resolve(__dirname, '..'), 'lib', 'usage');
const student = require(path.join(U, 'student'));
const teacher = require(path.join(U, 'teacher'));

function rows() {
  const out = [];
  const add = (text, mood, valence, register, target, n) => { for (let i = 0; i < n; i++) out.push({ id: `${mood}${i}`, text: `${text} ${i % 3 ? '' : 'pls'}`.trim(), mood, valence, register, target }); };
  add('no this is wrong again, it broke the build', 'frustrated', -0.7, 'casual', 'ai', 30);
  add('i wonder if we could try a different layout for the map?', 'curious', 0.2, 'casual', 'work', 30);
  add('hahaha love it, this looks great', 'pleased', 0.8, 'casual', 'ai', 30);
  add('Please update the proposal and send it to the client by Friday.', 'focused', 0, 'formal', 'work', 30);
  return out;
}

test('student: learns separable labels and scores offline', () => {
  const data = rows();
  const model = student.train(data, { epochs: 15 });
  const score = student.load(JSON.parse(JSON.stringify(model)));
  const r = student.evaluate(score, data);
  assert.ok(r.mood.agree >= 0.95, `mood agreement ${r.mood.agree}`);
  assert.ok(r.register.agree >= 0.95);
  assert.strictEqual(score('ugh wrong again, it broke').mood, 'frustrated');
  assert.ok(score('hahaha love this').valence > 0.3);
  assert.ok(JSON.stringify(model).length < 600 * 1024, 'model stays small');
});

test('student: features are words, pairs and style flags only', () => {
  const f = student.featurize('WHY is this broken?!');
  assert.ok(f.length > 4);
  assert.ok(f.every((i) => Number.isInteger(i) && i >= 0 && i < student.DIM));
});

test('teacher: schema and labels are fixed sets', () => {
  assert.deepStrictEqual(teacher.SCHEMA.properties.labels.items.required, ['i', 'mood', 'valence', 'register', 'target']);
  assert.ok(teacher.MOODS.includes('frustrated') && teacher.MOODS.includes('neutral'));
  assert.ok(!/Jarrhey/.test(teacher.SYSTEM));
});

test('tone: held-out split is stable per id', () => {
  const { split } = require(path.join(U, 'tone'));
  const data = rows();
  const a = split(data); const b = split(data.slice().reverse());
  assert.deepStrictEqual(a.test.map((r) => r.id).sort(), b.test.map((r) => r.id).sort());
  assert.ok(a.test.length > 10 && a.test.length < 50);
});

test('rollup: writes day, week and profile files without a model', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-rollup-'));
  const dir = path.join(tmp, 'claude', '-p');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const lines = [];
  for (let i = 0; i < 8; i++) {
    const ts = new Date(now.getTime() - (8 - i) * 60000).toISOString();
    lines.push(JSON.stringify({ sessionId: 's', cwd: '/w/app', type: 'user', uuid: 'u' + i, timestamp: ts, promptSource: 'typed', origin: { kind: 'human' }, message: { content: 'fix the page again ' + i } }));
  }
  fs.writeFileSync(path.join(dir, 's.jsonl'), lines.join('\n') + '\n');
  const cfg = path.join(tmp, 'os.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ identity: { timezone: 'UTC' }, paths: { vaultRoot: '' }, usage: { model: false } }));
  const env = { HELM_CONFIG: cfg, HELM_USAGE_DIR: path.join(tmp, 'out'), HELM_CLAUDE_PROJECTS: path.join(tmp, 'claude'), HELM_CODEX_SESSIONS: path.join(tmp, 'none') };
  const old = {}; for (const k of Object.keys(env)) { old[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    for (const k of Object.keys(require.cache)) if (k.startsWith(U)) delete require.cache[k];
    const { rollup } = require(path.join(U, 'rollup'));
    const w = rollup({ noModel: true });
    const day = now.toISOString().slice(0, 10);
    const dayFile = fs.readFileSync(path.join(env.HELM_USAGE_DIR, 'days', day + '.md'), 'utf8');
    assert.match(dayFile, /messages: 8/);
    assert.ok(!dayFile.includes('fix the page'), 'day files hold no message text');
    assert.ok(fs.existsSync(path.join(env.HELM_USAGE_DIR, 'profile.md')));
    assert.ok(w.some((f) => f.includes('.nosync') && f.endsWith('dashboard.html')), 'snapshot stays local');
  } finally { for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
});
