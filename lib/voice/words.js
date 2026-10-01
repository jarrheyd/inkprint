'use strict';
/**
 * Your words: how often you use each word, set against how often English
 * does. A word English uses a lot and you almost never do is out of
 * character for you. A word that is rare in both is a name or jargon and
 * is left alone. One vocabulary for all your channels, built from your own
 * sends (nothing your AI sent, nothing you pasted from it).
 */
const fs = require('fs');
const path = require('path');
const { tokens, proseOf, STOP } = require('../usage/features');

const ENGLISH_FILE = path.join(__dirname, '..', '..', 'models', 'english-freq.json');
const EXPECT_NEVER = 2;    // English predicts this many uses in your sends and you have none
const EXPECT_RARE = 5;     // or this many, and you use it under a tenth as often
const RARE_SHARE = 0.1;
const SIGNATURE_MIN = 20;  // uses before a word can be one of yours
const SIGNATURE_RATIO = 3; // and this many times more often than English
const AI_MIN = 3;           // AI drafts sent as you that use a word you never do, before it counts
const MAX_FINDINGS = 12;

let english = null;
const shown = new Map(); // "ill" -> "i'll": how to print a word whose apostrophe the tokenizer dropped
function show(w) { const e = shown.get(w); return e && e[1] >= (english.get(w) || 0) / 2 ? e[0] : w; }
function loadEnglish() {
  if (english) return english;
  english = new Map();
  // Same shape tokens() gives your words: apostrophes dropped, so "it's" and "its" are one entry.
  for (const [w, f] of Object.entries(JSON.parse(fs.readFileSync(ENGLISH_FILE, 'utf8')).words)) {
    const k = w.replace(/['\u2019]/g, '');
    english.set(k, (english.get(k) || 0) + f);
    if (k !== w && !(shown.has(k) && shown.get(k)[1] >= f)) shown.set(k, [w, f]);
  }
  return english;
}

function content(word) { return word.length >= 3 && !STOP.has(word) && !/\d/.test(word); }

/**
 * @param rows    your clean sends across every channel
 * @param drafts  AI drafts sent under your name (pasted by you or sent for you), the contrast:
 *                a word they use and you never do is the clearest sign of a draft that isn't you
 */
function buildVocab(rows, drafts = []) {
  const en = loadEnglish();
  const counts = {};
  let total = 0;
  for (const r of rows) for (const w of tokens(proseOf(r.text))) { counts[w] = (counts[w] || 0) + 1; total++; }
  const signature = [];
  for (const [w, c] of Object.entries(counts)) {
    if (c < SIGNATURE_MIN || !content(w) || !en.has(w)) continue;
    const ratio = (c / total) / en.get(w);
    if (ratio >= SIGNATURE_RATIO) signature.push([w, c, Math.round(ratio)]);
  }
  signature.sort((a, b) => b[1] - a[1]);
  const ai = {};
  // Counted per draft, not per use: a style word turns up across drafts, a topic word piles up in one.
  for (const r of drafts) for (const w of new Set(tokens(proseOf(r.text)))) if (content(w) && en.has(w) && !counts[w]) ai[w] = (ai[w] || 0) + 1;
  for (const w of Object.keys(ai)) if (ai[w] < AI_MIN) delete ai[w];
  // The card's list: common words you never use, the ones AI drafts reach for first.
  const never = Object.entries(ai).map(([w, n]) => [w, n, Math.round(en.get(w) * total)]).sort((a, b) => b[1] - a[1]);
  return { total, sends: rows.length, counts, ai, signature: signature.slice(0, 40), never: never.slice(0, 40) };
}

/** Words that only ever appear capitalised, at least once mid-sentence: names, not vocabulary. */
function namesIn(text) {
  const seen = new Map(); // word -> { lower, capMid }
  const re = /[\p{L}][\p{L}\p{N}'’-]*/gu;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const w = raw.toLowerCase().replace(/['’]/g, '');
    const before = text.slice(0, m.index).replace(/[ \t"'(\[*_#>-]+$/, '');
    const start = !before || /[.!?:\n]$/.test(before);
    const e = seen.get(w) || { lower: false, capMid: false };
    if (raw[0] === raw[0].toLowerCase()) e.lower = true;
    else if (!start) e.capMid = true;
    seen.set(w, e);
  }
  return new Set([...seen].filter(([, e]) => e.capMid && !e.lower).map(([w]) => w));
}

/**
 * Out-of-character words in a draft. Each one is a soft finding: it warns,
 * it never blocks.
 * @returns [{ word, count, expected, text }]
 */
function scoreWords(draft, vocab) {
  if (!vocab || !vocab.total) return [];
  const en = loadEnglish();
  const prose = proseOf(String(draft || ''));
  const names = namesIn(prose);
  const out = [];
  const done = new Set();
  for (const w of tokens(prose)) {
    if (done.has(w)) continue;
    done.add(w);
    if (!content(w) || names.has(w) || !en.has(w)) continue;
    const expected = en.get(w) * vocab.total;
    const count = vocab.counts[w] || 0;
    const never = count === 0 && (expected >= EXPECT_NEVER || (vocab.ai && vocab.ai[w] >= AI_MIN));
    const rare = expected >= EXPECT_RARE && count / expected < RARE_SHARE;
    if (!never && !rare) continue;
    out.push({ word: w, count, expected: Math.round(expected) });
  }
  out.sort((a, b) => b.expected - a.expected);
  const k = `${Math.round(vocab.total / 1000)}k`;
  return out.slice(0, MAX_FINDINGS).map((f) => ({ ...f, text: `"${show(f.word)}": ${f.count === 0 ? "you've never used it" : `you've used it ${f.count === 1 ? 'once' : `${f.count} times`}`} in ${k} words of your own; English would expect about ${f.expected}.` }));
}

function toMarkdown(vocab) {
  const k = `${Math.round(vocab.total / 1000)}k`;
  const L = ['# Your words', '', `From ${vocab.sends} of your own sends across every channel, ${k} words. Rebuilt nightly; drafts and documents are checked against it.`, ''];
  L.push('## Words you reach for', '', 'You use these far more than English in general does.', '');
  L.push(vocab.signature.map(([w, c, r]) => `- ${show(w)} (${c}, ${r}x)`).join('\n'), '');
  if (vocab.never.length) {
    L.push('## Words AI drafts use and you never do', '', 'Each of these shows up in drafts sent under your name. None are in anything you typed.', '');
    L.push(vocab.never.map(([w, n]) => `- ${w} (in ${n} drafts)`).join('\n'));
  }
  return L.join('\n') + '\n';
}

module.exports = { buildVocab, scoreWords, toMarkdown, namesIn, loadEnglish };
