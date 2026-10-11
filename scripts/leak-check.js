#!/usr/bin/env node
'use strict';
/**
 * Boundary guard. Fails if private data is about to enter this repo: a secret,
 * a real email, a home path, or any word on your private denylist.
 *
 * The denylist is NOT in this repo, because a list of names to hide is itself
 * the leak. It lives on your machine, one entry per line, at HELM_DENYLIST or
 * ~/.config/helm-os/denylist.txt. Lines starting with # are comments. A plain
 * line matches anywhere, case-insensitive. A line starting with "=" matches as
 * a whole word, case-sensitive, which is how you list short codes ("=ABC"). A
 * line starting with "~" is a regular expression.
 *
 * A repo that must carry one of those words (your own name as its author) lists
 * the exact phrase in .leak-allow at its root.
 *
 *   node scripts/leak-check.js              every tracked file
 *   node scripts/leak-check.js --staged     what is about to be committed
 *   node scripts/leak-check.js --message F  a commit message file
 *   node scripts/leak-check.js --history    every version of every file, plus all commit messages
 *   node scripts/leak-check.js --ident      the name and email your commits will carry (denylist only)
 *   --strict                                fail when no denylist is found
 *
 * Hooks in .githooks/ run these on commit and on push. Turn them on once per
 * clone: git config core.hooksPath .githooks
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// Checks that need no list: they catch the usual accidents in any clone.
const GENERIC = [
  { t: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY/ },
  { t: 'api key', re: /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abp]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|ya29\.[0-9A-Za-z_-]{20,})/ },
  { t: 'home path', re: /(\/Users\/(?!alex\b|you\b|me\b|x\b|a\b|name\b)[A-Za-z0-9._-]+\/|com~apple~CloudDocs\/[A-Za-z])/ },
  { t: 'email address', re: /\b[A-Za-z0-9._%+-]+@(?<!\bno-?reply@)(?!example\.|[a-z0-9-]+\.example\b|users\.noreply\.github\.com|([a-z0-9-]+\.)*acme\.|[a-z0-9]{1,2}\.[a-z]{2,3}\b|s\.whatsapp\.net)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/ },
];

function denylistFile() {
  return process.env.HELM_DENYLIST || path.join(os.homedir(), '.config', 'helm-os', 'denylist.txt');
}

function loadDenylist() {
  let text;
  try { text = fs.readFileSync(denylistFile(), 'utf8'); } catch { return null; }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    if (l.startsWith('=')) return { t: 'denylist', re: new RegExp(`(?<![A-Za-z0-9])${esc(l.slice(1))}(?![A-Za-z0-9])`) };
    if (l.startsWith('~')) return { t: 'denylist', re: new RegExp(l.slice(1), 'i') };
    return { t: 'denylist', re: new RegExp(esc(l), 'i') };
  });
}

// .leak-allow in the repo root: one phrase per line that is allowed to appear even
// though the denylist names it (the author's own name in a LICENSE, say). Each
// phrase is cut from a line before the line is checked.
function loadAllow() {
  let text;
  try { text = fs.readFileSync(path.join(ROOT, '.leak-allow'), 'utf8'); } catch { return []; }
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}
// "file:<path>" skips one file whole (a word list, a font). Use it sparingly.
const ALLOW_LINES = loadAllow();
const SKIP_FILES = new Set(ALLOW_LINES.filter((l) => l.startsWith('file:')).map((l) => l.slice(5).trim()));
const ALLOW = ALLOW_LINES.filter((l) => !l.startsWith('file:')).map((l) => new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));

function scan(text, label, needles, hits) {
  if (SKIP_FILES.has(String(label).split('@')[0])) return;
  text.split('\n').forEach((raw, i) => {
    let line = raw;
    for (const a of ALLOW) line = line.replace(a, '');
    for (const { t, re } of needles) if (re.test(line)) hits.push({ where: `${label}:${i + 1}`, kind: t });
  });
}

function main() {
  const args = process.argv.slice(2);
  const deny = loadDenylist();
  if (!deny && args.includes('--strict')) {
    console.error(`LEAK CHECK FAILED: no denylist at ${denylistFile()}. This clone is set to require one (--strict).`);
    process.exit(1);
  }
  const needles = [...GENERIC, ...(deny || [])];
  const hits = [];
  let scanned = 0;
  const isText = (buf) => !buf.includes(0);

  const mi = args.indexOf('--message');
  if (args.includes('--ident')) {
    scan(`${git('var', 'GIT_AUTHOR_IDENT')}\n${git('var', 'GIT_COMMITTER_IDENT')}`, 'commit identity (git config user.name / user.email)', deny || [], hits);
    scanned = 1;
  } else if (mi >= 0) {
    scan(fs.readFileSync(args[mi + 1], 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n'), 'commit message', needles, hits);
    scanned = 1;
  } else if (args.includes('--history')) {
    const seen = new Set();
    for (const line of git('rev-list', '--all', '--objects').split('\n')) {
      const [sha, ...rest] = line.split(' ');
      const name = rest.join(' ');
      if (!name || seen.has(sha)) continue;
      seen.add(sha);
      if (git('cat-file', '-t', sha).trim() !== 'blob') continue;
      const buf = execFileSync('git', ['cat-file', '-p', sha], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
      if (isText(buf)) { scan(buf.toString('utf8'), `${name}@${sha.slice(0, 7)}`, needles, hits); scanned++; }
    }
    scan(git('log', '--all', '--format=%B'), 'commit messages', needles, hits);
  } else {
    const staged = args.includes('--staged');
    const files = (staged ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR') : git('ls-files')).split('\n').filter(Boolean);
    for (const f of files) {
      let buf;
      try { buf = staged ? execFileSync('git', ['show', `:${f}`], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 }) : fs.readFileSync(path.join(ROOT, f)); } catch { continue; }
      if (isText(buf)) { scan(buf.toString('utf8'), f, needles, hits); scanned++; }
    }
  }

  if (hits.length) {
    // The matched text is never printed, so a failing run cannot leak into a log.
    console.error('LEAK CHECK FAILED: private data found.\n');
    for (const h of hits.slice(0, 60)) console.error(`  ${h.where}  (${h.kind})`);
    if (hits.length > 60) console.error(`  ... and ${hits.length - 60} more`);
    console.error(`\n${hits.length} hit(s). Move the value into your config or vault, or make the example generic.`);
    process.exit(1);
  }
  console.log(`leak-check clean: scanned ${scanned} ${mi >= 0 || args.includes('--ident') ? 'item' : 'files'}${deny ? ` against ${deny.length} denylist entries` : ' (generic checks only: no private denylist on this machine)'}`);
}

main();
