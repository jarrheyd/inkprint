'use strict';
/**
 * Put inkprint in the background, and take it back out.
 *   - a copy of the app in ~/.inkprint/app, so hooks survive npx clearing its cache
 *   - a nightly launchd job (plain node, no agent session, no tokens)
 *   - the voice check as a hook in Claude Code and, if present, Codex
 * Every settings file gets a backup before it's touched, and uninstall
 * removes exactly the entries inkprint added.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LABEL = 'com.inkprint.nightly';

// Draft and send tools across the common connectors (Gmail, Outlook, Discord, Teams, Telegram, WhatsApp, Slack, generic).
const SEND_MATCH = 'mcp__.*__(send_message|send_email|reply|forward|create_draft|update_draft|discord_send|discord_reply_to_forum|gmail_draft|gmail_send_email|outlook_send_mail|outlook_create_draft|outlook_create_reply_draft|outlook_create_reply_all_draft|outlook_update_draft|teams_send_channel_message|teams_reply_channel_message|teams_send_chat_message|slack_post_message|slack_reply_to_thread)';

function home() { return os.homedir(); }
function appDir(dataDir) { return path.join(dataDir, 'app'); }
function readJson(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } }

/** Copy the package (bin, lib, page, models, package.json) to a stable place. */
function installApp(dataDir) {
  const dest = appDir(dataDir);
  if (path.resolve(ROOT) === path.resolve(dest)) return dest;
  fs.rmSync(dest, { recursive: true, force: true });
  for (const d of ['bin', 'lib', 'page', 'models']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dest, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dest, 'package.json'));
  return dest;
}

function bin(dataDir) { return path.join(appDir(dataDir), 'bin', 'inkprint.js'); }

function plist(dataDir) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${esc(process.execPath)}</string><string>${esc(bin(dataDir))}</string><string>nightly</string></array>
<key>EnvironmentVariables</key><dict><key>INKPRINT_DIR</key><string>${esc(dataDir)}</string><key>PATH</key><string>${esc(process.env.PATH || '/usr/bin:/bin')}</string></dict>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>23</integer><key>Minute</key><integer>0</integer></dict>
<key>StandardErrorPath</key><string>${esc(path.join(dataDir, 'nightly.log'))}</string>
<key>StandardOutPath</key><string>${esc(path.join(dataDir, 'nightly.log'))}</string>
</dict></plist>
`;
}

function launchDir() { return process.env.INKPRINT_LAUNCH_DIR || path.join(home(), 'Library', 'LaunchAgents'); }

/** Add or remove our PreToolUse entry in a Claude-style hooks file. */
function editHooks(file, dataDir, remove) {
  if (!fs.existsSync(path.dirname(file))) return 'skipped';
  const exists = fs.existsSync(file);
  const s = readJson(file, {});
  s.hooks = s.hooks || {};
  const before = (s.hooks.PreToolUse || []);
  const ours = (h) => /bin[\\/]inkprint\.js" hook$/.test(String(h.command || ''));
  const kept = before.filter((e) => !(e.hooks || []).some(ours));
  if (remove && kept.length === before.length) return 'absent';
  if (exists) fs.copyFileSync(file, file + '.inkprint-bak');
  s.hooks.PreToolUse = kept;
  if (!remove) s.hooks.PreToolUse.push({ matcher: SEND_MATCH, hooks: [{ type: 'command', command: `INKPRINT_DIR="${dataDir}" "${process.execPath}" "${bin(dataDir)}" hook`, timeout: 5 }] });
  if (!s.hooks.PreToolUse.length) delete s.hooks.PreToolUse;
  if (!Object.keys(s.hooks).length) delete s.hooks;
  if (remove && !Object.keys(s).length) { fs.rmSync(file, { force: true }); return 'removed'; } // we created it; leave nothing behind
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
  return remove ? 'removed' : 'added';
}

function claudeSettings() { return process.env.INKPRINT_CLAUDE_SETTINGS || path.join(home(), '.claude', 'settings.json'); }
function codexHooks() { return process.env.INKPRINT_CODEX_HOOKS || path.join(home(), '.codex', 'hooks.json'); }

function install(dataDir, opts = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const out = { app: installApp(dataDir) };
  if (process.platform === 'darwin' || process.env.INKPRINT_LAUNCH_DIR) {
    fs.mkdirSync(launchDir(), { recursive: true });
    const f = path.join(launchDir(), LABEL + '.plist');
    fs.writeFileSync(f, plist(dataDir));
    out.nightly = f;
  }
  if (opts.hooks !== false) {
    out.claude = editHooks(claudeSettings(), dataDir, false);
    out.codex = editHooks(codexHooks(), dataDir, false);
  }
  return out;
}

function uninstall(dataDir, opts = {}) {
  const out = {};
  const f = path.join(launchDir(), LABEL + '.plist');
  out.nightly = fs.existsSync(f) ? (fs.rmSync(f), 'removed') : 'absent';
  out.claude = editHooks(claudeSettings(), dataDir, true);
  out.codex = editHooks(codexHooks(), dataDir, true);
  if (opts.data) { fs.rmSync(dataDir, { recursive: true, force: true }); out.data = 'removed'; }
  else { fs.rmSync(appDir(dataDir), { recursive: true, force: true }); out.data = 'kept'; }
  return out;
}

module.exports = { install, uninstall, editHooks, SEND_MATCH, LABEL, bin, appDir };
