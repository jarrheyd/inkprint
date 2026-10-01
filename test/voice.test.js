'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const V = path.join(ROOT, 'lib', 'voice');
const card = require(path.join(V, 'card'));
const { check, splitDraft } = require(path.join(V, 'score'));

function chatRows(n, chat = 'team') {
  const rows = [];
  let t = Date.parse('2026-09-01T01:00:00Z');
  for (let i = 0; i < n; i++) {
    // pairs of quick sends (a split thought), then a gap
    t += i % 2 ? 30 * 1000 : 60 * 60 * 1000;
    rows.push({ channel: 'discord', chat, to: '', ts: new Date(t).toISOString(), text: i % 5 === 0 ? 'nice one ra' : `few gaps ${i}` });
  }
  return rows;
}

test('card: bursts, percentiles, casing and habits', () => {
  const rows = chatRows(40);
  const c = card.build(rows, { channel: 'discord', particles: ['ra'] });
  assert.strictEqual(c.sends, 40);
  assert.strictEqual(c.bursts, 20, 'sends 30s apart join one burst');
  assert.strictEqual(c.sendsPerBurst.p50, 2);
  assert.strictEqual(c.lower, 1);
  assert.strictEqual(c.greeting, 0);
  assert.ok(c.words.p90 <= 3);
  assert.ok(c.particles.ra > 0);
  const md = card.toMarkdown(c);
  assert.ok(!md.includes('few gaps 7'), 'the synced card holds no message text');
  assert.match(md, /words per send: \d+ typical/);
});

test('card: email is one send per burst, greetings and sign-offs counted', () => {
  const rows = [0, 1, 2].map((i) => ({ channel: 'email', chat: 's', ts: `2026-09-0${i + 1}T01:00:00Z`, text: `Hi team,\n\nUpdate ${i}.\n\nThanks,\nSam` }));
  const c = card.build(rows, { channel: 'email' });
  assert.strictEqual(c.bursts, 3);
  assert.strictEqual(c.greeting, 1);
  assert.strictEqual(c.signoff, 1);
  assert.strictEqual(c.paragraphs.p50, 3);
});

test('check: in-voice passes, formal block is out of voice, thin cards never block', () => {
  const c = card.build(chatRows(40), { channel: 'discord' });
  const ok = check('nice one\nfew gaps', c, { minSends: 30 });
  assert.strictEqual(ok.block, false);
  const bad = check('Hi team! I wanted to share a few thoughts on the proposal we discussed yesterday, including timelines, owners and risks, so everyone is aligned before Friday. Thanks.', c, { minSends: 30 });
  assert.strictEqual(bad.block, true);
  assert.ok(bad.hard >= 2);
  assert.ok(bad.findings.some((f) => /greeting/.test(f.text)));
  const thin = card.build(chatRows(10), { channel: 'discord' });
  assert.strictEqual(check('Hi team! A long formal message that goes on and on for many words indeed. Thanks.', thin, { minSends: 30 }).block, false);
  assert.deepStrictEqual(splitDraft('a\n\nb\nc', 'discord'), ['a', 'b', 'c']);
  assert.strictEqual(splitDraft('a\n\nb', 'email').length, 1);
});

function env(tmp) {
  const cfg = path.join(tmp, 'os.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ identity: { name: 'Sam', timezone: 'UTC' }, identityIds: { whatsapp: ['111'] }, paths: { vaultRoot: '' }, voice: { whatsappDb: path.join(tmp, 'wa', 'messages.db') }, usage: { aliases: { Dana: ['Dan'] } } }));
  return { HELM_CONFIG: cfg, HELM_USAGE_DIR: path.join(tmp, 'out'), HELM_VOICE_CARDS: path.join(tmp, 'cards') };
}
function withEnv(e, fn) { const o = {}; for (const k of Object.keys(e)) { o[k] = process.env[k]; process.env[k] = e[k]; } try { return fn(); } finally { for (const k of Object.keys(e)) { if (o[k] === undefined) delete process.env[k]; else process.env[k] = o[k]; } } }
function fresh() { for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}routines${path.sep}`)) delete require.cache[k]; }

test('whatsapp: reads your sends from the bridge db, names chats, skips notes to self', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-voice-'));
  const e = env(tmp);
  fs.mkdirSync(path.join(tmp, 'wa'));
  const { DatabaseSync } = require('node:sqlite');
  const m = new DatabaseSync(path.join(tmp, 'wa', 'messages.db'));
  m.exec(`CREATE TABLE chats (jid TEXT PRIMARY KEY, name TEXT, last_message_time TIMESTAMP);
    CREATE TABLE messages (id TEXT, chat_jid TEXT, sender TEXT, content TEXT, timestamp TIMESTAMP, is_from_me BOOLEAN, media_type TEXT);`);
  m.exec(`INSERT INTO chats VALUES ('555@lid', '555', NULL), ('g1@g.us', 'Launch group', NULL), ('111@lid', '111', NULL);`);
  const ins = m.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)');
  ins.run('a', '555@lid', 'me', 'sige dan', '2026-09-01 09:00:00+08:00', 1, '');
  ins.run('b', 'g1@g.us', 'me', 'shipping today', '2026-09-01 10:00:00+08:00', 1, '');
  ins.run('c', '555@lid', 'x', 'their message', '2026-09-01 11:00:00+08:00', 0, '');
  ins.run('d', '111@lid', 'me', 'note to self', '2026-09-01 12:00:00+08:00', 1, '');
  m.close();
  const c = new DatabaseSync(path.join(tmp, 'wa', 'whatsapp.db'));
  c.exec(`CREATE TABLE whatsmeow_contacts (our_jid TEXT, their_jid TEXT, first_name TEXT, full_name TEXT, push_name TEXT);
    CREATE TABLE whatsmeow_lid_map (lid TEXT, pn TEXT);
    INSERT INTO whatsmeow_contacts VALUES ('me', '639@s.whatsapp.net', NULL, 'Dan Cruz', NULL);
    INSERT INTO whatsmeow_lid_map VALUES ('555', '639');`);
  c.close();
  withEnv(e, () => {
    fresh();
    const r = require(path.join(V, 'collect-whatsapp')).collect();
    assert.strictEqual(r.added, 2);
    const rows = require(path.join(V, 'sends')).read(e.HELM_USAGE_DIR, 'whatsapp');
    assert.deepStrictEqual(rows.map((x) => x.text), ['sige dan', 'shipping today']);
    assert.strictEqual(rows[0].to, 'Dana', 'lid -> phone -> contact name -> person alias');
    assert.strictEqual(rows[1].to, 'Launch group');
    assert.strictEqual(require(path.join(V, 'collect-whatsapp')).collect().added, 0, 'incremental');
  });
});

test('inbox + build + check CLI + hook: person card beats channel card', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-voice-'));
  const e = env(tmp);
  withEnv(e, () => {
    fresh();
    const sends = require(path.join(V, 'sends'));
    const D = sends.dirs(e.HELM_USAGE_DIR);
    fs.mkdirSync(D.sends, { recursive: true });
    const lines = chatRows(40, 'dm').map((r) => JSON.stringify({ ...r, to: 'Dan' }));
    fs.writeFileSync(D.inbox, lines.concat(lines.slice(0, 5)).join('\n') + '\n');
    const out = require(path.join(V, 'build')).build();
    assert.strictEqual(out.inbox, 40, 'duplicates from the inbox are dropped');
    assert.ok(out.cards.includes('discord') && out.cards.includes('discord--dana'));
    assert.ok(fs.existsSync(path.join(e.HELM_VOICE_CARDS, 'discord--dana.md')));
    const { run } = require(path.join(V, 'check'));
    assert.match(run('discord', 'Dan', 'ok').card, /to Dana/, 'an alias finds the person card');
    const hook = (payload) => spawnSync(process.execPath, [path.join(V, 'hook.js')], { input: JSON.stringify(payload), env: { ...process.env, ...e }, encoding: 'utf8' });
    const bad = hook({ tool_name: 'mcp__discord__discord_send', tool_input: { message: 'Hi team! I wanted to share a few thoughts on the proposal we discussed yesterday, including timelines, owners and risks, so everyone is aligned before Friday. Thanks.' } });
    assert.strictEqual(bad.status, 2);
    assert.match(bad.stderr, /OUT OF VOICE/);
    assert.strictEqual(hook({ tool_name: 'mcp__discord__discord_send', tool_input: { message: 'nice one ra' } }).status, 0);
    assert.strictEqual(hook({ tool_name: 'mcp__x__create_draft', tool_input: { to: ['a@b.co'], subject: 's', body: 'Hi there, long formal email.' } }).status, 0, 'no email card: pass');
    assert.strictEqual(hook({ tool_name: 'Write', tool_input: { content: 'x' } }).status, 0);
    const off = spawnSync(process.execPath, [path.join(V, 'hook.js')], { input: JSON.stringify({ tool_name: 'mcp__discord__discord_send', tool_input: { message: 'Hi team! I wanted to share a few thoughts on the proposal we discussed yesterday, including timelines, owners and risks, so everyone is aligned before Friday. Thanks.' } }), env: { ...process.env, ...e, DISABLE_VOICE_CHECK: '1' } });
    assert.strictEqual(off.status, 0);
  });
});

test('setup: hooks added once, removed cleanly, settings byte-identical after uninstall', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkprint-setup-'));
  fs.mkdirSync(path.join(tmp, 'claude')); fs.mkdirSync(path.join(tmp, 'codex'));
  const settings = path.join(tmp, 'claude', 'settings.json');
  const original = JSON.stringify({ model: 'opus', hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo mine' }] }] } }, null, 2) + '\n';
  fs.writeFileSync(settings, original);
  const e = { INKPRINT_CLAUDE_SETTINGS: settings, INKPRINT_CODEX_HOOKS: path.join(tmp, 'codex', 'hooks.json'), INKPRINT_LAUNCH_DIR: path.join(tmp, 'launch'), INKPRINT_APP: path.join(tmp, 'app') };
  withEnv(e, () => {
    fresh();
    const setup = require(path.join(ROOT, 'lib', 'setup'));
    const data = path.join(tmp, 'data');
    let out = setup.install(data);
    assert.strictEqual(out.claude, 'added');
    assert.strictEqual(out.codex, 'added');
    setup.install(data);
    const s = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assert.strictEqual(s.hooks.PreToolUse.length, 2, 'installing twice adds one entry');
    assert.match(s.hooks.PreToolUse[1].matcher, /create_draft/);
    assert.ok(fs.existsSync(path.join(tmp, 'app', 'bin', 'inkprint.js')), 'the app is copied somewhere stable, outside the data folder');
    assert.ok(fs.existsSync(path.join(tmp, 'launch', setup.LABEL + '.plist')));
    out = setup.uninstall(data);
    assert.strictEqual(fs.readFileSync(settings, 'utf8'), original, 'your settings come back exactly as they were');
    assert.ok(!fs.existsSync(path.join(tmp, 'codex', 'hooks.json')) || !/inkprint/.test(fs.readFileSync(path.join(tmp, 'codex', 'hooks.json'), 'utf8')));
    assert.ok(!fs.existsSync(path.join(tmp, 'launch', setup.LABEL + '.plist')));
    assert.ok(!fs.existsSync(path.join(tmp, 'app')));
  });
});

// ---- words: your vocabulary against English, pasted drafts kept out ----

test('pasted: long and laid out is an AI draft, long and plain is yours, short lists are fine', () => {
  const { isPasted } = require(path.join(V, 'sends'));
  const long = 'okay so we need to check this again before friday '.repeat(12);
  assert.strictEqual(isPasted(long), false, 'a long message you typed stays');
  assert.strictEqual(isPasted(`## Summary\n${long}\n- first point\n- second point`), true);
  assert.strictEqual(isPasted(`**Cost.** ${long}`), false, 'one mark is not a layout');
  assert.strictEqual(isPasted(`**Cost.** ${long}\n**Risk.** ${long}`), true, 'two bold labels are');
  assert.strictEqual(isPasted('- milk\n- eggs\n- rice'), false, 'short lists are how people type');
});

test('words: common in English and absent from yours warns; names, jargon and your own words pass', () => {
  const words = require(path.join(V, 'words'));
  const vocab = { total: 200000, sends: 9000, counts: { okay: 700, need: 500, check: 370, build: 60, flag: 20, behind: 30, set: 150, told: 60, against: 1 }, ai: { grounded: 4 } };
  const found = (t) => words.scoreWords(t, vocab).map((f) => f.word);
  assert.deepStrictEqual(found('The build sits behind a flag.'), ['sits']);
  assert.deepStrictEqual(found('okay need to check the build'), [], 'your own words pass');
  assert.deepStrictEqual(found('We told Rey that LaunchDarkly is set up at Medical City.'), [], 'names and jargon are rare in English too');
  assert.ok(found('We tested it against the old one.').includes('against'), 'used far less than English expects');
  assert.ok(found('A grounded plan.').includes('grounded'), 'in AI drafts sent as you, never in your own');
  assert.match(words.scoreWords('It sits there.', vocab)[0].text, /"sits": you've never used it in 200k words of your own; English would expect about 3/);
  assert.deepStrictEqual(words.scoreWords('It sits there.', null), [], 'no word list yet: nothing to say');
});

test('words: findings warn and never block, on a chat card or a document', () => {
  const vocab = { total: 200000, sends: 9000, counts: { nice: 90, one: 400 }, ai: {} };
  const c = card.build(chatRows(60), { channel: 'discord' });
  const r = check('therefore sits', c, { vocab });
  assert.ok(r.findings.some((f) => f.kind === 'word' && !f.hard));
  assert.strictEqual(r.block, false, 'two word warnings are not two misses');
  assert.strictEqual(r.hard, 0);
});

test('build + doc check + hook: word list built from clean sends, a document warns once then goes through', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-voice-'));
  const e = env(tmp);
  withEnv(e, () => {
    fresh();
    for (const k of Object.keys(require.cache)) if (k.startsWith(ROOT + path.sep + 'lib')) delete require.cache[k];
    const sends = require(path.join(V, 'sends'));
    const D = sends.dirs(e.HELM_USAGE_DIR);
    fs.mkdirSync(D.sends, { recursive: true });
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    const rows = [];
    for (let i = 0; i < 6000; i++) rows.push({ channel: 'discord', chat: 'team', to: '', ts: new Date(t0 + i * 3600 * 1000).toISOString(), text: `${i} okay need to check this one again sige send it later today thanks` });
    // Three AI drafts pasted in and sent: they must not teach the cards anything.
    const draft = (i) => `## Update ${i}\nThe service sits behind the gateway and the remaining work is grounded in the audit. ${'This paragraph pads the draft past the length where a typed message usually stops. '.repeat(6)}\n- first\n- second`;
    for (let i = 0; i < 3; i++) rows.push({ channel: 'discord', chat: 'team', to: '', ts: new Date(t0 + (7000 + i * 30) * 3600 * 1000).toISOString(), text: draft(i) });
    fs.writeFileSync(D.inbox, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const out = require(path.join(V, 'build')).build();
    assert.ok(out.cards.includes('words'));
    const vocab = JSON.parse(fs.readFileSync(path.join(D.cards, 'words.json'), 'utf8'));
    assert.strictEqual(vocab.sends, 6000, 'pasted drafts are left out of your words');
    assert.strictEqual(vocab.counts.sits, undefined);
    assert.strictEqual(vocab.ai.sits, 3, 'and kept as the contrast');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(D.cards, 'discord.json'), 'utf8')).sends, 6000, 'and out of the channel card');
    const md = fs.readFileSync(path.join(e.HELM_VOICE_CARDS, 'words.md'), 'utf8');
    assert.match(md, /## Words you reach for[\s\S]*- check \(6000/);
    assert.match(md, /## Words AI drafts use and you never do[\s\S]*- sits \(in 3 drafts\)/);

    const cli = (args, input) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'inkprint.js'), 'check', ...args], { input, env: { ...process.env, ...e }, encoding: 'utf8' });
    const doc = cli(['--channel', 'doc'], 'The release sits behind a flag, therefore nothing changes for Rey at Medical City.');
    assert.strictEqual(doc.status, 0, 'a document never blocks');
    assert.match(doc.stdout, /check on your documents/);
    assert.match(doc.stdout, /"sits"/);
    assert.match(doc.stdout, /"therefore"/);
    assert.doesNotMatch(doc.stdout, /"rey"|"medical"/);
    assert.match(cli(['--channel', 'doc'], 'okay need to check this one again').stdout, /fits how you write/);

    const hook = (payload) => spawnSync(process.execPath, [path.join(V, 'hook.js')], { input: JSON.stringify(payload), env: { ...process.env, ...e }, encoding: 'utf8' });
    const drive = { tool_name: 'mcp__abc__create_file', tool_input: { title: 'Plan', contentMimeType: 'text/html', textContent: '<h1>Plan</h1><p>The release sits behind a flag, therefore nothing changes.</p>' } };
    const first = hook(drive);
    assert.strictEqual(first.status, 2, 'first time: pause with the warning');
    assert.match(first.stderr, /"sits"[\s\S]*send the same text again/);
    assert.strictEqual(hook(drive).status, 0, 'same text again: through');
    assert.strictEqual(hook({ ...drive, tool_input: { ...drive.tool_input, textContent: '<p>okay need to check this one again</p>' } }).status, 0, 'your own words: no pause');
    assert.strictEqual(hook({ tool_name: 'mcp__abc__create_file', tool_input: { title: 'Deck', base64Content: 'UEsDBA==' } }).status, 0, 'a binary upload has no words to check');
    const page = path.join(tmp, 'page.html');
    fs.writeFileSync(page, '<html><style>p{color:red}</style><p>The plan sits here, therefore we wait.</p></html>');
    assert.strictEqual(hook({ tool_name: 'Artifact', tool_input: { file_path: page } }).status, 2, 'a published page is a document');
    assert.strictEqual(hook({ tool_name: 'Artifact', tool_input: { action: 'read', url: 'https://x' } }).status, 0, 'reading one is not');
    // A chat send with a word warning and nothing else wrong pauses once too.
    const chat = { tool_name: 'mcp__discord__discord_send', tool_input: { message: 'okay therefore check this' } };
    assert.strictEqual(hook(chat).status, 2);
    assert.strictEqual(hook(chat).status, 0);
  });
});
