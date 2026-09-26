'use strict';
/**
 * A voice card: how you write in one channel (or to one person), measured
 * from your own sends. Numbers only, plus the words you open with and the
 * phrases you repeat. The checker scores drafts against it.
 */
const { tokens, proseOf, STOP } = require('../usage/features');

const BURST_GAP_MS = 2 * 60 * 1000; // sends to the same chat within 2 minutes are one thought, split
const GREETING = /^(hi|hello|hey|hiya|good (morning|afternoon|evening|day)|gm|dear|morning)\b/i;
const SIGNOFF = /(\b(thanks|thank you|thx|regards|best|cheers|salamat|sincerely)\b[\s,!.]*([a-z]+[.!]?)?\s*$)|(\n\s*-?\s*[A-Z][a-z]+\s*$)/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const LAUGH = /\b(ha(ha)+h?|he(he)+|lol+|lmao+)\b/i;

function pct(list, p) {
  if (!list.length) return 0;
  const s = list.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}
function share(list, fn) { return list.length ? Math.round((list.filter(fn).length / list.length) * 1000) / 1000 : 0; }

/** Group sends into bursts: same chat, each within 2 minutes of the last. Email is one send per burst. */
function bursts(rows) {
  const out = [];
  const lastByChat = new Map();
  for (const r of rows) {
    const t = Date.parse(r.ts);
    const prev = lastByChat.get(r.chat);
    if (r.channel !== 'email' && prev && t - prev.t <= BURST_GAP_MS) prev.burst.push(r);
    else { const b = [r]; out.push(b); lastByChat.set(r.chat, { t, burst: b }); continue; }
    prev.t = t;
  }
  return out;
}

function sendStats(text) {
  const t = String(text).trim();
  const words = tokens(t).length;
  return {
    words,
    lower: /[a-z]/.test(t) && t === t.toLowerCase(),
    period: /[^.]\.$/.test(t),
    question: /\?/.test(t),
    exclaim: /!/.test(t),
    emoji: EMOJI.test(t),
    laugh: LAUGH.test(t),
    paragraphs: t.split(/\n\s*\n/).filter((x) => x.trim()).length,
  };
}

/**
 * @param rows  sends for one channel (or one person in it), oldest first
 * @param opts  { particles: string[], languages: {name: string[]}, channel, label }
 */
function build(rows, opts = {}) {
  const stats = rows.map((r) => sendStats(r.text));
  const bs = bursts(rows);
  const first = bs.map((b) => String(b[0].text).trim());
  const last = bs.map((b) => String(b[b.length - 1].text).trim());
  const allTokens = rows.flatMap((r) => tokens(r.text));
  const particles = {};
  for (const p of opts.particles || []) { const n = allTokens.filter((w) => w === p.toLowerCase()).length; if (n) particles[p] = Math.round((n / (allTokens.length || 1)) * 1000 * 10) / 100; }
  const langs = {};
  for (const [name, list] of Object.entries(opts.languages || {})) {
    const lex = new Set(list.map((w) => w.toLowerCase()));
    langs[name] = Math.round((allTokens.filter((w) => lex.has(w)).length / (allTokens.length || 1)) * 1000) / 1000;
  }
  const openers = {};
  for (const f of first) { const k = tokens(f).slice(0, 2).join(' '); if (k) openers[k] = (openers[k] || 0) + 1; }
  const phrases = {};
  for (const r of rows) {
    const tk = tokens(proseOf(r.text));
    for (let i = 0; i + 1 < tk.length; i++) {
      if (STOP.has(tk[i]) && STOP.has(tk[i + 1])) continue; // "on the", "it is": filler, not a phrase of yours
      const k = tk[i] + ' ' + tk[i + 1]; phrases[k] = (phrases[k] || 0) + 1;
    }
  }
  const top = (o, n, min = 2) => Object.entries(o).filter(([, v]) => v >= min).sort((a, b) => b[1] - a[1]).slice(0, n);
  const words = stats.map((s) => s.words);
  const perBurst = bs.map((b) => b.length);
  return {
    channel: opts.channel, label: opts.label || opts.channel,
    sends: rows.length, bursts: bs.length,
    from: rows[0] && rows[0].ts, until: rows.length ? rows[rows.length - 1].ts : null,
    words: { p10: pct(words, 10), p50: pct(words, 50), p90: pct(words, 90) },
    sendsPerBurst: { p50: pct(perBurst, 50), p90: pct(perBurst, 90), splitShare: share(perBurst, (n) => n > 1) },
    paragraphs: { p50: pct(stats.map((s) => s.paragraphs), 50), p90: pct(stats.map((s) => s.paragraphs), 90) },
    lower: share(stats, (s) => s.lower),
    period: share(stats, (s) => s.period),
    question: share(stats, (s) => s.question),
    exclaim: share(stats, (s) => s.exclaim),
    emoji: share(stats, (s) => s.emoji),
    laugh: share(stats, (s) => s.laugh),
    greeting: share(first, (t) => GREETING.test(t)),
    signoff: share(last, (t) => SIGNOFF.test(t)),
    particles, langs,
    openers: top(openers, 10),
    phrases: top(phrases, 15, 3),
  };
}

function pctText(x) { return `${Math.round((x || 0) * 100)}%`; }

/** The synced card: numbers, openers and phrases, no message text. */
function toMarkdown(card) {
  const L = [];
  L.push(`# How you write: ${card.label}`, '');
  L.push(`From ${card.sends} of your sends${card.from ? `, ${card.from.slice(0, 10)} to ${String(card.until).slice(0, 10)}` : ''}. Rebuilt nightly; drafts are checked against it.`, '');
  L.push('## Shape', '');
  L.push(`- words per send: ${card.words.p50} typical, ${card.words.p10} to ${card.words.p90} most of the time`);
  if (card.channel !== 'email') L.push(`- one thought split into several sends ${pctText(card.sendsPerBurst.splitShare)} of the time, up to ${card.sendsPerBurst.p90} sends`);
  else L.push(`- paragraphs: ${card.paragraphs.p50} typical, up to ${card.paragraphs.p90}`);
  L.push(`- opens with a greeting: ${pctText(card.greeting)}`, `- ends with a sign-off: ${pctText(card.signoff)}`);
  L.push(`- all lowercase: ${pctText(card.lower)}`, `- ends with a period: ${pctText(card.period)}`);
  L.push(`- questions ${pctText(card.question)}, exclamation marks ${pctText(card.exclaim)}, emoji ${pctText(card.emoji)}, laughs ${pctText(card.laugh)}`);
  const parts = Object.entries(card.particles).sort((a, b) => b[1] - a[1]);
  if (parts.length) L.push(`- particles per 100 words: ${parts.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const [k, v] of Object.entries(card.langs)) if (v) L.push(`- ${k} words: ${pctText(v)}`);
  if (card.openers.length) L.push('', '## How you open', '', card.openers.map(([k, v]) => `- "${k}" (${v})`).join('\n'));
  if (card.phrases.length) L.push('', '## Phrases you repeat', '', card.phrases.map(([k, v]) => `- "${k}" (${v})`).join('\n'));
  return L.join('\n') + '\n';
}

module.exports = { build, bursts, sendStats, toMarkdown, GREETING, SIGNOFF };
