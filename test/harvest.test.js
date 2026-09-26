'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { harvest, ownEmailText, tidy } = require(path.join(ROOT, 'lib', 'harvest'));
const corrections = require(path.join(ROOT, 'lib', 'corrections'));

const self = { names: new Set(['sam cruz', 'me', 'sam']), emails: new Set(['sam@acme.co']), discordIds: new Set(['42']) };

test('gmail: only your mail, full body, quoted history dropped', () => {
  const out = harvest('mcp__abc__get_thread', { threadId: 't' }, JSON.stringify({ messages: [
    { sender: 'Dana <dana@x.co>', plaintextBody: 'can you send it', date: '2026-09-01T01:00:00Z', subject: 'Deck' },
    { sender: 'Sam Cruz <sam@acme.co>', plaintextBody: 'Hi Dana,\n\nAttached.\n\nThanks,\nSam\n\nOn Mon, Sep 1, 2026 at 9:00 AM Dana <dana@x.co> wrote:\n> can you send it', date: '2026-09-01T02:00:00Z', subject: 'Deck', toRecipients: ['Dana <dana@x.co>'] },
  ] }), self);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].channel, 'email');
  assert.strictEqual(out[0].to, 'Dana');
  assert.ok(!/wrote/.test(out[0].text) && /Thanks,\nSam$/.test(out[0].text));
  assert.strictEqual(ownEmailText('Done. :) On Tue, Sep 15, 2026 at 10:46 AM Erin <e@x.co> wrote: hi'), 'Done. :)');
});

test('discord json: by your author id, or your name', () => {
  const body = JSON.stringify({ messages: [[{ content: 'nice one', author: { id: '42', username: 'samc' }, timestamp: '2026-09-01T01:00:00Z', channel_id: 'c1' }], [{ content: 'their take', author: { id: '7', username: 'dana' }, timestamp: '2026-09-01T01:01:00Z', channel_id: 'c1' }]] });
  const out = harvest('mcp__discord__discord_search_messages', { guildId: 'g' }, body, self);
  assert.deepStrictEqual(out.map((r) => r.text), ['nice one']);
});

test('line readers: telegram "me", google chat full name with email, continuation lines', () => {
  const tg = harvest('mcp__telegram__read_chat', { chat: 'Team' }, '[2026-09-21 05:55] Dana: are we set?\n[2026-09-21 06:23] me: yes sige\nsending now\n[2026-09-21 06:30] Dana: ok', self);
  assert.deepStrictEqual(tg.map((r) => r.text), ['yes sige\nsending now']);
  assert.strictEqual(tg[0].chat, 'Team');
  const gc = harvest('mcp__google-chat-ro__list_messages', { space: 'spaces/x' }, '[2026-09-16 20:10] Sam Cruz <sam@acme.co>: pwede pa screenshot\n    thread: spaces/x/threads/y\n[2026-09-16 20:12] Dana Lee: sure', self);
  assert.deepStrictEqual(gc.map((r) => r.text), ['pwede pa screenshot']);
});

test('whatsapp and teams formats', () => {
  const wa = harvest('mcp__whatsapp-ro__list_messages', {}, '[2026-09-16 10:13:40] Chat: Launch From: Me: shipping today\n[2026-09-16 10:14:00] Chat: Launch From: Dana: nice\n[2026-09-16 10:15:00] Chat: Launch From: Me: [image - Message ID: 1]', self);
  assert.deepStrictEqual(wa.map((r) => r.text), ['shipping today'], 'media placeholders are not your words');
  const teams = harvest('mcp__m365__chat_message_search', {}, JSON.stringify([{ chatId: 'c', summary: 'will test tonight', createdDateTime: '2026-09-14T11:30:41Z', from: { displayName: 'Sam Cruz', email: null } }, { chatId: 'c', summary: 'thanks', from: { displayName: 'Dana Lee', email: null } }]), self);
  assert.deepStrictEqual(teams.map((r) => r.text), ['will test tonight']);
  assert.strictEqual(tidy('<@123> <@456>'), '', 'a message that is only mentions carries no voice');
  assert.deepStrictEqual(harvest('mcp__unknown__whatever', {}, 'me: hello', self), []);
});

test('corrections: your replies to drafts become counted rules', () => {
  assert.deepStrictEqual(corrections.rulesIn('too long, and no em dash pls'), ['shorter', 'no-em-dash']);
  assert.deepStrictEqual(corrections.rulesIn('sounds like AI lol'), ['sounds-ai']);
  assert.deepStrictEqual(corrections.rulesIn('ship it'), []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkprint-corr-'));
  corrections.record(dir, [{ id: 'a', ts: '2026-09-01', text: 'too long' }, { id: 'b', ts: '2026-09-02', text: 'shorter pls' }, { id: 'c', ts: '2026-09-03', text: 'no em dash' }]);
  corrections.record(dir, [{ id: 'a', ts: '2026-09-01', text: 'too long' }]);
  assert.deepStrictEqual(corrections.active(dir).map((r) => [r.key, r.count]), [['shorter', 2]], 'a rule is enforced once said twice, and replays do not double count');
});

test('ingest end to end: harvest keeps your messages, drops what your AI sent as you, records corrections', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkprint-e2e-'));
  const proj = path.join(tmp, 'claude', '-w');
  fs.mkdirSync(proj, { recursive: true });
  const L = (o) => JSON.stringify({ sessionId: 's', cwd: '/w', ...o }) + '\n';
  fs.writeFileSync(path.join(proj, 's.jsonl'),
    L({ type: 'assistant', uuid: 'a1', timestamp: '2026-09-01T01:00:00Z', message: { id: 'm1', model: 'x', usage: {}, content: [{ type: 'tool_use', id: 'send1', name: 'mcp__telegram__send_message', input: { chat: 'Team', message: 'Morning brief: three items need you today' } }] } }) +
    L({ type: 'assistant', uuid: 'a2', timestamp: '2026-09-01T01:01:00Z', message: { id: 'm2', model: 'x', usage: {}, content: [{ type: 'tool_use', id: 'read1', name: 'mcp__telegram__read_chat', input: { chat: 'Team' } }] } }) +
    L({ type: 'user', uuid: 'u1', timestamp: '2026-09-01T01:01:05Z', message: { content: [{ type: 'tool_result', tool_use_id: 'read1', content: '[2026-09-01 01:00] me: Morning brief: three items need you today\n[2026-08-31 09:00] me: sige will check later\n[2026-08-31 09:05] Dana: ok' }] } }) +
    L({ type: 'assistant', uuid: 'a3', timestamp: '2026-09-01T01:02:00Z', message: { id: 'm3', model: 'x', usage: {}, content: [{ type: 'text', text: 'Here is a draft reply:\n\n> Hi Dana, thanks so much for the update!' }] } }) +
    L({ type: 'user', uuid: 'u2', timestamp: '2026-09-01T01:03:00Z', promptSource: 'typed', origin: { kind: 'human' }, message: { content: 'too long and no em dash' } }));
  const cfg = path.join(tmp, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ fullName: 'Sam Cruz', timezone: 'UTC' }));
  const env = { INKPRINT_CONFIG: cfg, INKPRINT_DIR: path.join(tmp, 'data'), INKPRINT_CLAUDE_PROJECTS: path.join(tmp, 'claude'), INKPRINT_CODEX_SESSIONS: path.join(tmp, 'none'), INKPRINT_CARDS: path.join(tmp, 'cards') };
  const old = {}; for (const k of Object.keys(env)) { old[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'lib'))) delete require.cache[k];
    const r = require(path.join(ROOT, 'lib', 'usage', 'ingest')).ingest({ rebuild: true });
    const sends = require(path.join(ROOT, 'lib', 'voice', 'sends')).read(env.INKPRINT_DIR, 'telegram');
    assert.deepStrictEqual(sends.map((x) => x.text), ['sige will check later'], 'the brief your AI posted as you is not your voice');
    assert.strictEqual(r.harvested, 1);
    const rules = require(path.join(ROOT, 'lib', 'corrections')).load(env.INKPRINT_DIR).rules;
    assert.strictEqual(rules.shorter.count, 1);
    assert.strictEqual(rules['no-em-dash'].count, 1);
  } finally { for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
});
