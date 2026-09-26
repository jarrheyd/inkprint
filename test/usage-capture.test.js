'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const U = path.join(ROOT, 'lib', 'usage');
const { classify } = require(path.join(U, 'layer'));

const OPTS = { osPrefixes: ['REFRESH BEFORE YOU PRESENT'], ownerName: 'Sam' };

test('layer: typed prompt is you, harness noise is dropped, automation is os', () => {
  assert.strictEqual(classify('fix the header spacing pls', OPTS).layer, 'you');
  assert.strictEqual(classify('<command-name>/model</command-name>', OPTS).layer, 'drop');
  assert.strictEqual(classify('[Request interrupted by user]', OPTS).layer, 'drop');
  assert.strictEqual(classify('<scheduled-task name="brief">run it</scheduled-task>', OPTS).layer, 'os');
  assert.strictEqual(classify('**refresh before you present** this chip', OPTS).layer, 'os');
  assert.strictEqual(classify("You are Sam's assistant. Sweep the inbox.", OPTS).layer, 'os');
  assert.strictEqual(classify('Produce the case studies Sam committed to', OPTS).layer, 'os');
  assert.strictEqual(classify('open the Sam OS folder', OPTS).layer, 'you');
});

test('layer: injected blocks are stripped before counting', () => {
  const r = classify('<system-reminder>ctx</system-reminder>\nship it [Image: source: /tmp/a.png]', OPTS);
  assert.strictEqual(r.layer, 'you');
  assert.strictEqual(r.text, 'ship it');
  assert.strictEqual(classify('<system-reminder>only ctx</system-reminder>', OPTS).layer, 'drop');
  const codexFiles = classify('# Files mentioned by the user:\n\n## a.png: /tmp/a.png\n## My request:\nmake it faster', OPTS);
  assert.strictEqual(codexFiles.text, 'make it faster');
});

function line(o) { return JSON.stringify(o) + '\n'; }

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-usage-'));
  const claude = path.join(tmp, 'claude', '-proj-app');
  const sub = path.join(claude, 's1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const base = { sessionId: 's1', cwd: '/work/app', isSidechain: false };
  fs.writeFileSync(path.join(claude, 's1.jsonl'),
    line({ ...base, type: 'user', uuid: 'u1', timestamp: '2026-09-01T01:00:00Z', promptSource: 'typed', origin: { kind: 'human' }, message: { content: 'no, that is wrong again hahaha ra' } }) +
    line({ ...base, type: 'user', uuid: 'u2', timestamp: '2026-09-01T01:00:05Z', isMeta: true, message: { content: 'meta' } }) +
    line({ ...base, type: 'assistant', uuid: 'a1', timestamp: '2026-09-01T01:00:10Z', message: { id: 'msg1', model: 'claude-x', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100 }, content: [{ type: 'tool_use', id: 'tu1', name: 'Read' }] } }) +
    line({ ...base, type: 'assistant', uuid: 'a2', timestamp: '2026-09-01T01:00:11Z', message: { id: 'msg1', model: 'claude-x', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100 }, content: [{ type: 'text', text: 'ok' }] } }) +
    line({ ...base, type: 'user', uuid: 'u3', timestamp: '2026-09-01T01:00:12Z', message: { content: [{ type: 'tool_result', content: 'file' }] } }) +
    line({ ...base, type: 'user', uuid: 'u4', timestamp: '2026-09-01T01:01:00Z', promptSource: 'system', origin: { kind: 'task-notification' }, message: { content: 'agent finished' } }));
  fs.writeFileSync(path.join(sub, 'agent-1.jsonl'),
    line({ ...base, isSidechain: true, type: 'user', uuid: 'u5', timestamp: '2026-09-01T01:02:00Z', message: { content: 'Audit the repo' } }));
  const chipDir = path.join(tmp, 'claude', '-proj-os');
  fs.mkdirSync(chipDir, { recursive: true });
  fs.writeFileSync(path.join(chipDir, 's2.jsonl'),
    line({ sessionId: 's2', cwd: '/work/os', type: 'user', uuid: 'c1', timestamp: '2026-09-02T01:00:00Z', promptSource: 'sdk', origin: { kind: 'human' }, message: { content: 'REFRESH BEFORE YOU PRESENT - reply to the thread' } }) +
    line({ sessionId: 's2', cwd: '/work/os', type: 'user', uuid: 'c2', timestamp: '2026-09-02T01:05:00Z', promptSource: 'sdk', origin: { kind: 'human' }, message: { content: 'sige send it' } }));
  const codexDir = path.join(tmp, 'codex', '2026', '09', '03');
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, 'rollout-a.jsonl'),
    line({ timestamp: '2026-09-03T02:00:00Z', ordinal: 0, type: 'session_meta', payload: { id: 'x1', cwd: '/work/trip', thread_source: 'user', originator: 'Codex Desktop' } }) +
    line({ timestamp: '2026-09-03T02:00:01Z', ordinal: 1, type: 'turn_context', payload: { cwd: '/work/trip', model: 'gpt-x' } }) +
    line({ timestamp: '2026-09-03T02:00:02Z', ordinal: 2, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n<cwd>/work</cwd>\n</environment_context>' }, { type: 'input_text', text: 'make the map load faster?' }] } }) +
    line({ timestamp: '2026-09-03T02:00:09Z', ordinal: 3, type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1' } }) +
    line({ timestamp: '2026-09-03T02:00:10Z', ordinal: 4, type: 'token_usage_record', payload: { response_id: 'r1', usage: { input_tokens: 50, cached_input_tokens: 30, output_tokens: 7 } } }));
  fs.writeFileSync(path.join(codexDir, 'rollout-b.jsonl'),
    line({ timestamp: '2026-09-03T03:00:00Z', ordinal: 0, type: 'session_meta', payload: { id: 'x2', cwd: '/work/trip', thread_source: 'user', originator: 'codex_exec' } }) +
    line({ timestamp: '2026-09-03T03:00:02Z', ordinal: 1, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Run the brief' }] } }));
  const cfgFile = path.join(tmp, 'os.config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ identity: { name: 'Sam', timezone: 'UTC' }, paths: { vaultRoot: '' }, usage: { osPrefixes: ['REFRESH BEFORE YOU PRESENT'], particles: ['ra'] } }));
  return { tmp, cfgFile, env: { HELM_CONFIG: cfgFile, HELM_USAGE_DIR: path.join(tmp, 'out'), HELM_CLAUDE_PROJECTS: path.join(tmp, 'claude'), HELM_CODEX_SESSIONS: path.join(tmp, 'codex') } };
}

function withEnv(env, fn) {
  const old = {};
  for (const k of Object.keys(env)) { old[k] = process.env[k]; process.env[k] = env[k]; }
  try { return fn(); } finally { for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
}

test('ingest: layers, token dedupe, tools, and no message text on disk', () => {
  const f = fixture();
  withEnv(f.env, () => {
    delete require.cache[require.resolve(path.join(U, 'ingest'))];
    const { ingest } = require(path.join(U, 'ingest'));
    ingest({ rebuild: true });
    const store = require(path.join(U, 'store'));
    const P = store.paths(f.env.HELM_USAGE_DIR);
    const ev = store.readAll(P.events);
    const prompts = ev.filter((e) => e.kind === 'prompt');
    const you = prompts.filter((e) => e.layer === 'you').map((e) => e.id).sort();
    assert.deepStrictEqual(you, ['c2', 'u1', 'x:x1:2']);
    const os_ = prompts.filter((e) => e.layer === 'os').map((e) => e.id).sort();
    assert.deepStrictEqual(os_, ['c1', 'u4', 'u5', 'x:x2:1']);
    const u1 = prompts.find((e) => e.id === 'u1');
    assert.strictEqual(u1.correction, 1);
    assert.strictEqual(u1.laugh, 1);
    assert.deepStrictEqual(u1.particles, { ra: 1 });
    assert.strictEqual(prompts.find((e) => e.id === 'c2').sessionLayer, 'os', 'chip session belongs to the OS even when you reply in it');
    const model = ev.filter((e) => e.kind === 'model' && e.tool === 'claude');
    assert.strictEqual(model.length, 1);
    assert.strictEqual(model[0].out, 20, 'split assistant records count once');
    const cx = ev.find((e) => e.kind === 'model' && e.tool === 'codex');
    assert.deepStrictEqual([cx.model, cx.in, cx.cacheRead, cx.out], ['gpt-x', 20, 30, 7]);
    const tools = ev.filter((e) => e.kind === 'tool');
    assert.deepStrictEqual(tools.map((t) => Object.keys(t.tools)[0]).sort(), ['Read', 'shell']);
    const raw = fs.readdirSync(P.events).map((x) => fs.readFileSync(path.join(P.events, x), 'utf8')).join('');
    assert.ok(!raw.includes('wrong again'), 'events never hold message text');
    assert.ok(fs.existsSync(path.join(P.terms)), 'terms go to the local-only store');
    assert.ok(P.terms.includes('.nosync'));
  });
});

test('ingest: incremental run reads only new lines', () => {
  const f = fixture();
  withEnv(f.env, () => {
    delete require.cache[require.resolve(path.join(U, 'ingest'))];
    const { ingest } = require(path.join(U, 'ingest'));
    const first = ingest({ rebuild: true });
    assert.ok(first.events > 0);
    assert.strictEqual(ingest().events, 0);
    const file = path.join(f.env.HELM_CLAUDE_PROJECTS, '-proj-app', 's1.jsonl');
    fs.appendFileSync(file, line({ sessionId: 's1', cwd: '/work/app', type: 'user', uuid: 'u9', timestamp: '2026-09-01T02:00:00Z', promptSource: 'typed', origin: { kind: 'human' }, message: { content: 'ship it' } }));
    fs.appendFileSync(file, '{"partial":'); // a line still being written
    assert.strictEqual(ingest().events, 1);
    fs.appendFileSync(file, '1}\n');
    assert.strictEqual(ingest().events, 0, 'completed junk line parses to nothing');
  });
});

test('ingest: a rebuild keeps history whose transcripts were cleaned up', () => {
  const f = fixture();
  withEnv(f.env, () => {
    delete require.cache[require.resolve(path.join(U, 'ingest'))];
    const { ingest } = require(path.join(U, 'ingest'));
    const store = require(path.join(U, 'store'));
    ingest({ rebuild: true });
    // Claude Code prunes old sessions: the Sep 1 transcript disappears.
    fs.rmSync(path.join(f.env.HELM_CLAUDE_PROJECTS, '-proj-app', 's1.jsonl'));
    ingest({ rebuild: true });
    const ids = store.readAll(store.paths(f.env.HELM_USAGE_DIR).events).filter((e) => e.kind === 'prompt').map((e) => e.id);
    assert.ok(ids.includes('u1'), 'the Sep 1 prompt survives the rebuild');
    assert.ok(ids.includes('c2'), 'transcripts still on disk are re-read');
  });
});
