'use strict';
/**
 * Where inkprint reads from and writes to, and what it knows about you.
 * Works with no config at all: everything is detected. Two optional sources,
 * first match wins:
 *   - ~/.inkprint/config.json (or INKPRINT_CONFIG), flat keys
 *   - a helm-os vault (HELM_CONFIG / HELM_VAULT): os.config.json `usage` and
 *     `voice` blocks, data under <vault>/_usage, cards under Personal/voice
 * Env overrides for tests and embedding: INKPRINT_DIR, INKPRINT_CARDS,
 * INKPRINT_CLAUDE_PROJECTS, INKPRINT_CODEX_SESSIONS (":"-separated).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const detect = require('./detect');

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function env(...names) { for (const n of names) if (process.env[n]) return process.env[n]; return ''; }

/** The opening words of the chip preamble a helm vault ships, so those prompts count as the OS. */
function chipPrefix(vault) {
  try {
    const txt = fs.readFileSync(path.join(vault, '_meta', 'chip-preamble.md'), 'utf8');
    const body = txt.split(/^---\s*$/m)[1] || '';
    const first = body.trim().split('\n')[0].split('[')[0].split(' - ')[0].trim();
    return first.length >= 12 ? first.slice(0, 40) : '';
  } catch { return ''; }
}

function load() {
  const home = os.homedir();
  const helmFile = env('HELM_CONFIG') || (process.env.HELM_VAULT && path.join(process.env.HELM_VAULT, 'os.config.json'));
  const helm = helmFile ? readJson(helmFile) : null;
  const own = helm ? null : readJson(env('INKPRINT_CONFIG') || path.join(env('INKPRINT_DIR') || path.join(home, '.inkprint'), 'config.json'));
  // One shape for both: `u` holds usage settings, `v` voice settings.
  const u = helm ? (helm.usage || {}) : (own || {});
  const v = helm ? (helm.voice || {}) : ((own && own.voice) || {});
  const vault = helm ? ((helm.paths && helm.paths.vaultRoot) || process.env.HELM_VAULT || '') : '';
  const dir = env('INKPRINT_DIR', 'HELM_USAGE_DIR') || u.dir || (vault ? path.join(vault, '_usage') : path.join(home, '.inkprint'));
  const src = detect.sources(home);
  const codex = env('INKPRINT_CODEX_SESSIONS', 'HELM_CODEX_SESSIONS');

  // Detection is cached so the nightly job and the hook stay fast.
  const cacheFile = path.join(dir, 'detected.json');
  let found = readJson(cacheFile);
  if (!found || found.home !== home || Date.now() - (found.at || 0) > 7 * 864e5) {
    const id = detect.identity(home);
    found = { home, at: Date.now(), name: id.name, fullName: id.fullName, emails: id.emails, whatsappDb: detect.whatsappDb(home) };
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(found)); } catch { /* read-only is fine */ }
  }

  const ownerName = (u.ownerName || (helm && helm.identity && helm.identity.name) || u.name || found.name || '').trim();
  const osPrefixes = (u.osPrefixes || []).concat(vault ? [chipPrefix(vault)] : []).filter(Boolean);
  return {
    cfg: helm || own || {},
    helm: !!helm,
    classifyOpts: { osPrefixes, ownerName },
    ownerName,
    emails: [...new Set([].concat(u.emails || [], found.emails || []).map((e) => String(e).toLowerCase()))],
    identityIds: (helm && helm.identityIds) || u.identityIds || {},
    vault,
    dir,
    claudeDir: env('INKPRINT_CLAUDE_PROJECTS', 'HELM_CLAUDE_PROJECTS') || u.claudeDir || src.claudeDir,
    codexDirs: codex ? codex.split(':') : (u.codexDirs || src.codexDirs),
    timezone: (helm && helm.identity && helm.identity.timezone) || u.timezone || detect.timezone(),
    particles: u.particles || [],
    languages: u.languages || {},
    projects: (helm && helm.projects) || u.projects || [],
    peopleFile: u.peopleFile ? path.resolve(vault || dir, u.peopleFile) : (vault ? path.join(vault, 'People', 'people.md') : ''),
    aliases: u.aliases || {},
    projectPaths: u.projectPaths || {},
    projectAliases: u.projectAliases || {},
    dayToDay: u.dayToDay || [],
    hubPaths: (u.hubPaths || []).concat(vault ? [vault] : []),
    prices: u.prices || {},
    // helm vaults opted in already; standalone never spends your tokens unless you turn it on.
    model: helm ? u.model !== false : u.model === true,
    codexModel: u.codexModel || '',
    port: u.port || 4747,
    voice: {
      channels: v.channels || ['whatsapp', 'telegram', 'discord', 'email', 'gchat', 'teams'],
      whatsappDb: v.whatsappDb === '' ? '' : (v.whatsappDb || found.whatsappDb || ''),
      minSends: v.minSends || 30,
      block: v.block !== false,
      cardDir: env('INKPRINT_CARDS', 'HELM_VOICE_CARDS') || v.cardDir || (vault ? path.join(vault, 'Personal', 'voice') : path.join(dir, 'cards')),
    },
  };
}

// The ported modules call it by its helm name.
module.exports = { load, loadUsageConfig: load, chipPrefix };
