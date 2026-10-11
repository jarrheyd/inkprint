'use strict';
/**
 * Everything inkprint needs to know about you, found on the machine instead
 * of asked for: your name, your email, your timezone, and where your AI
 * tools keep their transcripts. Each answer can be overridden in config.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function sh(cmd, args) { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim(); } catch { return ''; } }

/** Name and email from your Claude account, then git. */
function identity(home = os.homedir()) {
  const cj = readJson(path.join(home, '.claude.json')) || {};
  const acct = cj.oauthAccount || {};
  const gitName = process.env.HOME === home ? sh('git', ['config', '--global', 'user.name']) : '';
  const gitEmail = process.env.HOME === home ? sh('git', ['config', '--global', 'user.email']) : '';
  const full = acct.displayName || gitName || '';
  return {
    name: full.split(/\s+/)[0] || '',
    fullName: full,
    emails: [...new Set([acct.emailAddress, gitEmail].filter(Boolean).map((e) => e.toLowerCase()))],
  };
}

function timezone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }

function sources(home = os.homedir()) {
  return {
    claudeDir: path.join(home, '.claude', 'projects'),
    codexDirs: [path.join(home, '.codex', 'sessions'), path.join(home, '.codex', 'archived_sessions')],
  };
}

/**
 * A WhatsApp bridge database (the common whatsapp-mcp bridge keeps one at
 * whatsapp-bridge/store/messages.db). Looks a few levels deep in the usual
 * code folders, never the whole disk.
 */
function whatsappDb(home = os.homedir()) {
  if (process.env.INKPRINT_NO_SCAN === '1') return '';
  const roots = ['dev', 'Developer', 'code', 'Code', 'projects', 'src', 'Documents', 'GitHub', '.local', 'mcp'].map((d) => path.join(home, d)).concat([home]);
  const seen = new Set();
  const walk = (dir, depth) => {
    if (depth < 0 || seen.has(dir)) return null;
    seen.add(dir);
    const hit = path.join(dir, 'whatsapp-bridge', 'store', 'messages.db');
    if (fs.existsSync(hit)) return hit;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith('.') && e.name !== '.local' || e.name === 'node_modules' || e.name === 'Library') continue;
      const r = walk(path.join(dir, e.name), depth - 1);
      if (r) return r;
    }
    return null;
  };
  for (const r of roots) { const hit = walk(r, r === home ? 1 : 3); if (hit) return hit; }
  return '';
}

module.exports = { identity, timezone, sources, whatsappDb };
