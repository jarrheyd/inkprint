'use strict';
/**
 * Your voice rules, in your own words. When an AI hands you a draft and you
 * push back ("too long", "no long dashes", "don't start with hi", "sounds like
 * AI"), that reply is a rule. Each one is counted; the voice check enforces
 * a rule once you've said it twice.
 */
const fs = require('fs');
const path = require('path');

const LONG_DASH = String.fromCharCode(0x2014);

const RULES = [
  { key: 'shorter', label: 'keep it short', re: /\b(too long|shorter|shorten|more concise|cut it down|trim|less words|fewer words|tighten|too wordy|wordy)\b/i },
  { key: 'no-greeting', label: 'no greeting', re: /\b(no (hi|hello|greeting)|don'?t (start|open) with (hi|hello|a greeting)|remove the (hi|greeting)|skip the greeting)\b/i },
  { key: 'no-signoff', label: 'no sign-off', re: /\b(no sign.?off|don'?t sign off|remove the (sign.?off|thanks|regards)|no (thanks|regards) at the end)\b/i },
  { key: 'no-em-dash', label: 'no long dashes', re: new RegExp(`(em.?dash|${LONG_DASH})`, 'i') },
  { key: 'lowercase', label: 'lowercase', re: /\b(lower ?case|no caps|don'?t capitali[sz]e)\b/i },
  { key: 'less-formal', label: 'less formal', re: /\b(too formal|less formal|more casual|casual(ly)?|too stiff|too corporate)\b/i },
  { key: 'no-lists', label: 'no lists or numbering', re: /\b(no (bullets?|numbering|numbered list|lists?)|don'?t number|not a list|without (bullets|numbers))\b/i },
  { key: 'no-exclaim', label: 'no exclamation marks', re: /\b(no exclamation|too many exclamation|drop the !|remove the !)/i },
  { key: 'no-emoji', label: 'no emoji', re: /\b(no emojis?|remove the emojis?|without emojis?)\b/i },
  { key: 'sounds-ai', label: "doesn't sound like you", re: /\b(sounds? (like )?(ai|a bot|robotic|chatgpt|generic)|too ai|ai.?ish|slop|cheesy|not how i (talk|write|speak)|doesn'?t sound like me)\b/i },
];

/** Rules in one reply to a draft. */
function rulesIn(text) { return RULES.filter((r) => r.re.test(String(text || ''))).map((r) => r.key); }

function file(usageDir) { return path.join(usageDir, 'local.nosync', 'corrections.json'); }

function load(usageDir) { try { return JSON.parse(fs.readFileSync(file(usageDir), 'utf8')); } catch { return { seen: [], rules: {} }; } }

/** Record replies to drafts: [{ id, ts, text }]. Idempotent by id. */
function record(usageDir, replies) {
  if (!replies.length) return 0;
  const s = load(usageDir);
  const seen = new Set(s.seen);
  let n = 0;
  for (const r of replies) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    for (const key of rulesIn(r.text)) {
      const x = s.rules[key] || (s.rules[key] = { count: 0, first: r.ts, last: r.ts });
      x.count++; x.last = r.ts; n++;
    }
  }
  s.seen = [...seen].slice(-20000);
  fs.mkdirSync(path.dirname(file(usageDir)), { recursive: true });
  fs.writeFileSync(file(usageDir), JSON.stringify(s));
  return n;
}

/** Rules you've stated at least `min` times, strongest first, with plain labels. */
function active(usageDir, min = 2) {
  const s = load(usageDir);
  return RULES.filter((r) => (s.rules[r.key] || {}).count >= min).map((r) => ({ key: r.key, label: r.label, count: s.rules[r.key].count }))
    .sort((a, b) => b.count - a.count);
}

module.exports = { RULES, rulesIn, record, active, load, LONG_DASH };
