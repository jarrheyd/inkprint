#!/usr/bin/env node
'use strict';
/**
 * inkprint: how you work with AI, read from the transcripts already on your
 * machine, and a check that keeps drafts sounding like you.
 *
 *   npx github:jarrheyd/inkprint              set up (background job + voice check), read everything, open the page
 *                             flags: --no-open, --no-serve, --no-hooks
 *   inkprint open             open the live page
 *   inkprint report           short summary in the terminal
 *   inkprint check --channel <c> [--to name] "draft"
 *   inkprint tune             sharpen the mood read on your own messages (asks first: uses tokens)
 *   inkprint status           what's installed and what it has read
 *   inkprint uninstall [--data]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`inkprint needs Node 22.5 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}

const lib = (p) => require(path.join(__dirname, '..', 'lib', p));
const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('-') ? args.shift() : 'setup';
const has = (f) => args.includes(f);

function dataDir() { return lib('config').load().dir; }

function loadLaunchd(file) {
  if (process.platform !== 'darwin' || !file || process.env.INKPRINT_NO_LAUNCHCTL === '1') return;
  const uid = String(process.getuid());
  try { execFileSync('launchctl', ['bootout', `gui/${uid}/${lib('setup').LABEL}`], { stdio: 'ignore' }); } catch { /* not loaded yet */ }
  try { execFileSync('launchctl', ['bootstrap', `gui/${uid}`, file], { stdio: 'ignore' }); } catch { /* shown in status */ }
}

function nightly() {
  lib('usage/rollup').rollup({ noModel: !lib('config').load().model });
}

function serve(open) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'lib', 'usage', 'serve.js'), ...(open ? ['--open'] : [])], { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => process.exit(code || 0));
}

function setup() {
  const t0 = Date.now();
  const c = lib('config').load();
  console.log(`inkprint: reading your AI transcripts${c.ownerName ? ` (hi ${c.ownerName})` : ''}...`);
  lib('usage/ingest').ingest();
  const v = lib('voice/build').build();
  const out = lib('setup').install(c.dir, { hooks: !has('--no-hooks') });
  loadLaunchd(out.nightly);
  const m = lib('usage/report').build();
  console.log(`inkprint: ${m.you.prompts} of your messages across ${m.you.activeDays} days, ${v.cards.length} voice card${v.cards.length === 1 ? '' : 's'}, in ${((Date.now() - t0) / 1000).toFixed(0)}s.`);
  console.log(`inkprint: nightly refresh ${out.nightly ? 'scheduled' : 'not scheduled (macOS only for now)'}; voice check ${[out.claude === 'added' && 'on in Claude Code', out.codex === 'added' && 'on in Codex'].filter(Boolean).join(', ') || 'not installed'}.`);
  console.log(`inkprint: everything stays in ${c.dir}. Undo it all with: npx github:jarrheyd/inkprint uninstall`);
  if (!has('--no-serve')) serve(!has('--no-open'));
}

function status() {
  const c = lib('config').load();
  const setup = lib('setup');
  const plist = path.join(process.env.INKPRINT_LAUNCH_DIR || path.join(require('os').homedir(), 'Library', 'LaunchAgents'), setup.LABEL + '.plist');
  let cards = [];
  try { cards = JSON.parse(fs.readFileSync(path.join(c.dir, 'local.nosync', 'voice', 'index.json'), 'utf8')); } catch { /* none yet */ }
  console.log(`data: ${c.dir}`);
  console.log(`you: ${c.ownerName || 'unknown'}${c.emails.length ? ` <${c.emails.join(', ')}>` : ''}, ${c.timezone}`);
  console.log(`nightly job: ${fs.existsSync(plist) ? 'installed' : 'not installed'}`);
  console.log(`voice cards: ${cards.map((x) => `${x.key} (${x.sends})`).join(', ') || 'none yet'}`);
  console.log(`whatsapp bridge: ${c.voice.whatsappDb || 'not found'}`);
  console.log(`model reads: ${c.model ? 'on' : 'off (nothing spends your tokens)'}`);
}

async function tune() {
  if (!has('--yes')) {
    console.log('Tuning has a small model label 800 of your messages through your own `claude` (or `codex`) CLI,');
    console.log('then trains a local classifier on them. It costs roughly 120k tokens once, on your plan.');
    console.log('Run `inkprint tune --yes` to go ahead.');
    return;
  }
  const tone = lib('usage/tone');
  tone.teach(800);
  const s = tone.train();
  if (s) lib('usage/ingest').ingest({ rebuild: true });
}

function uninstall() {
  const out = lib('setup').uninstall(dataDir(), { data: has('--data') });
  if (process.platform === 'darwin') { try { execFileSync('launchctl', ['bootout', `gui/${process.getuid()}/${lib('setup').LABEL}`], { stdio: 'ignore' }); } catch { /* already gone */ } }
  console.log(`inkprint: nightly job ${out.nightly}, Claude Code hook ${out.claude}, Codex hook ${out.codex}, your data ${out.data}.`);
}

function check() {
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const channel = get('--channel'); const to = get('--to');
  const text = args.length ? args.join(' ') : fs.readFileSync(0, 'utf8');
  if (!channel) { console.error('usage: inkprint check --channel <whatsapp|telegram|discord|email|gchat|teams|slack> [--to name] "draft"'); process.exit(1); }
  const ck = lib('voice/check');
  const r = ck.run(channel, to, text);
  console.log(ck.format(r));
  process.exit(r.block ? 2 : 0);
}

const commands = {
  setup, status, uninstall, check, nightly,
  open: () => serve(true),
  report: () => execFileSync(process.execPath, [path.join(__dirname, '..', 'lib', 'usage', 'report.js')], { stdio: 'inherit', env: process.env }),
  tune: () => tune().catch((e) => { console.error(e.message); process.exit(1); }),
  hook: () => lib('voice/hook').main(),
};

if (!commands[cmd]) { console.error(`inkprint: unknown command "${cmd}". Try: open, report, check, tune, status, uninstall.`); process.exit(1); }
commands[cmd]();
