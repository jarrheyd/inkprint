'use strict';
/**
 * Decide whether a prompt was typed by the person ("you"), written by their
 * automation ("os"), or is not a message at all ("drop": command output,
 * interrupts, resume notices). Text is cleaned of injected blocks first.
 */

// Harness noise: never a message from anyone.
const DROP_PREFIXES = [
  '<task-notification', '<local-command-caveat', '<command-name', '<command-message',
  '<command-args', '<local-command-stdout', '<local-command-stderr', '<bash-input',
  '<bash-stdout', '<bash-stderr', '[Request interrupted', 'This session is being continued',
  'Base directory for this skill', 'The previous response failed', 'Continue from where you left off',
  'Caveat: The messages below', '<user-prompt-submit-hook', '<recommended_plugins', '<turn_aborted',
];

// Automation that speaks in the user role. Extended per user by config usage.osPrefixes.
const OS_PREFIXES = ['<scheduled-task', '<automation', '(Re-invocation of'];

// Blocks the harness injects inside a real prompt; stripped before counting.
const STRIP_BLOCKS = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<environment_context>[\s\S]*?<\/environment_context>/g,
  /<ide_selection>[\s\S]*?<\/ide_selection>/g,
  /<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g,
  /<image[^>]*>[\s\S]*?<\/image>/g,
  /<pasted_content[^>]*>[\s\S]*?<\/pasted_content>/g,
  /\[Image[^\]]*\]/g,
  /@"[^"]+"/g,
  /'(\/|~\/)[^'\n]+'/g, // a dragged-in file path, quoted
  /^# Files mentioned by the user:[\s\S]*?## My request[^\n]*\n?/m,
];

function clean(text) {
  let t = String(text || '');
  for (const re of STRIP_BLOCKS) t = t.replace(re, ' ');
  return t.replace(/[ \t]+\n/g, '\n').trim();
}

/**
 * People rarely write about themselves by name in the third person; the OS
 * does it constantly ("You are Sam's assistant", "Sam wants...", "Sam committed to"). Case
 * sensitive on purpose so an all-caps folder name does not trip it.
 */
function aboutOwner(text, ownerName) {
  if (!ownerName) return false;
  const n = ownerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${n}('s|\u2019s)\\b|\\b${n} [a-z]`).test(text);
}

/**
 * @param opts  { osPrefixes: string[], ownerName: string } or, for older
 *              callers, the osPrefixes array itself.
 */
function classify(rawText, opts) {
  const o = Array.isArray(opts) ? { osPrefixes: opts } : (opts || {});
  const raw = String(rawText || '').trimStart();
  for (const p of DROP_PREFIXES) if (raw.startsWith(p)) return { layer: 'drop', text: '' };
  const bare = (x) => x.replace(/^[\s*#_>]+/, '').toLowerCase();
  const head = bare(raw.slice(0, 200));
  for (const p of OS_PREFIXES.concat(o.osPrefixes || [])) if (p && bare(p) && head.startsWith(bare(p))) return { layer: 'os', text: clean(raw) };
  const text = clean(raw);
  if (!text) return { layer: 'drop', text: '' };
  if (aboutOwner(text, o.ownerName)) return { layer: 'os', text };
  return { layer: 'you', text };
}

module.exports = { classify, clean, aboutOwner, DROP_PREFIXES, OS_PREFIXES };
