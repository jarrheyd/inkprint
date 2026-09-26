'use strict';
/**
 * Zero-token text features for one prompt. Split into two parts on purpose:
 * `stats` (numbers only, safe to sync) and `terms` (words from the message,
 * kept in the local-only store).
 */

const STOP = new Set(('a about above after again all also am an and any are as at be because been before being below between both but by ' +
  'can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its ' +
  'itself just me more most my myself no nor not now of off on once only or other our ours out over own same she should so some such than that ' +
  'the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom ' +
  'why will with would you your yours yourself im ive id dont doesnt didnt cant wont isnt thats its lets u ur pls please okay ok yes yeah ' +
  'go get got make made want need like one also us see use using used way thing things still even much many well really').split(' '));

const CORRECTION = /^(no\b|nope|wrong|not\b|don'?t|stop|again\b|still\b|why (did|is|are)|that'?s not|undo|revert|incorrect|fix\b)|\b(you (didn'?t|forgot|missed|broke)|i (said|told you|asked)|not what i|try again)\b/i;
const LAUGH = /\b(ha(ha)+h?|he(he)+|lol+|lmao+|haha)\b/gi;

/**
 * Lines a person actually wrote, for word stats: drops URLs, file paths, and
 * lines that read as pasted code, logs, or data (symbol-heavy or JSON-ish).
 */
function proseOf(text) {
  const keep = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/https?:\/\/\S+/g, ' ').replace(/(^|\s)[~.]?\/[\w./-]+/g, ' ');
    const letters = (line.match(/\p{L}/gu) || []).length;
    const visible = line.replace(/\s/g, '').length;
    if (!visible) continue;
    if (letters / visible < 0.7) continue;
    if (/"\s*:|[{};]\s*$|=>|\b0x[0-9a-f]+/i.test(line)) continue;
    if (/\b[a-z]+[A-Z][a-zA-Z]+\b/.test(line) && letters > 80) continue; // camelCase-heavy dumps
    keep.push(line);
  }
  return keep.join('\n');
}

function tokens(text) {
  return (String(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) || []).map((w) => w.replace(/['\u2019]/g, ''));
}

/**
 * @param text       cleaned prompt text
 * @param opts       { particles: string[], languages: { name: string[] } }
 */
function features(text, opts = {}) {
  const t = String(text || '');
  const toks = tokens(t);
  const words = toks.length;
  const stats = {
    words,
    chars: t.length,
    question: /\?/.test(t) ? 1 : 0,
    correction: CORRECTION.test(t.trim()) ? 1 : 0,
    laugh: (t.match(LAUGH) || []).length,
    exclaim: (t.match(/!/g) || []).length,
    shout: words >= 3 && (t.match(/\b[A-Z]{4,}\b/g) || []).length / words >= 0.2 ? 1 : 0,
    lower: t && t === t.toLowerCase() && /[a-z]/.test(t) ? 1 : 0,
  };
  const parts = {};
  const counts = {};
  for (const w of toks) counts[w] = (counts[w] || 0) + 1;
  for (const p of opts.particles || []) {
    const k = p.toLowerCase();
    if (counts[k]) parts[k] = counts[k];
  }
  if (Object.keys(parts).length) stats.particles = parts;
  const langs = {};
  for (const [name, list] of Object.entries(opts.languages || {})) {
    let n = 0;
    const lex = new Set(list.map((w) => w.toLowerCase()));
    for (const w of toks) if (lex.has(w)) n++;
    if (n) langs[name] = n;
  }
  if (Object.keys(langs).length) stats.langs = langs;

  const prose = tokens(proseOf(t));
  const content = prose.filter((w) => w.length > 2 && !STOP.has(w) && !/\d/.test(w));
  const bigrams = [];
  for (let i = 0; i + 1 < prose.length; i++) {
    const a = prose[i]; const b = prose[i + 1];
    if (/\d/.test(a + b)) continue;
    if (STOP.has(b)) continue; // "create a", "lot of": the phrase ends on filler
    if (/^(a|an|the|this|that|these|those|my|your|our|its|some|any)$/.test(a)) continue; // "the app": an article, not a phrase
    bigrams.push(a + ' ' + b);
  }
  return { stats, terms: content, bigrams };
}

module.exports = { features, tokens, proseOf, STOP };
