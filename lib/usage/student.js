'use strict';
/**
 * The student: a local classifier that learns the teacher's labels and then
 * scores every message on this machine for free. Hashed word and word-pair
 * features, one softmax regression per label, ridge regression for valence.
 * Plain JS, no dependencies; the saved model is a small JSON file.
 */
const { tokens } = require('./features');

const DIM = 1 << 13;
const HEADS = ['mood', 'polarity', 'register', 'target'];

/** Negative / flat / positive, the coarse read the teacher is most consistent on. */
function polarityOf(mood) { return ({ frustrated: 'neg', stressed: 'neg', pleased: 'pos', playful: 'pos' })[mood] || 'flat'; }

// Word lists that carry meaning past the exact words seen in training.
const LEX = {
  neg: /\b(wrong|again|still|broke|broken|not working|doesn'?t work|didn'?t|ugh|incorrect|fail(ed|ing)?|annoying|sloppy|stuck|worse|bad|hate|weird|never)\b|\u{1F62D}|\u{1F624}|\u{1F644}/iu,
  pos: /\b(nice|great|love|perfect|thanks|thank you|awesome|amazing|beautiful|works now|working now|yay|finally)\b|\u{1F64F}|\u{2764}|\u{1F60D}|\u{1F525}/iu,
  cur: /\b(wonder|curious|what if|could we|can we|how about|is it possible|would it|should we|thoughts)\b/i,
  urg: /\b(asap|urgent|today|deadline|quick(ly)?|hurry|tomorrow|eod)\b/i,
  play: /\b(ha(ha)+|lol|lmao|jk|hehe)\b|\u{1F602}|\u{1F923}/iu,
  ack: /^(yes|yep|ok|okay|go|sure|continue|done|do it|proceed|sige|g)\b/i,
};

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % DIM;
}

/** Sparse binary features for one message: words, word pairs, and style flags. */
function featurize(text) {
  const t = String(text || '');
  const toks = tokens(t).slice(0, 200);
  const f = new Set();
  for (const w of toks) f.add(hash('w:' + w));
  for (let i = 0; i + 1 < toks.length; i++) f.add(hash('b:' + toks[i] + ' ' + toks[i + 1]));
  const n = toks.length;
  f.add(hash('len:' + (n <= 3 ? 's' : n <= 10 ? 'm' : n <= 30 ? 'l' : 'xl')));
  if (/\?/.test(t)) f.add(hash('flag:q'));
  if (/!/.test(t)) f.add(hash('flag:!'));
  if (/\b(ha(ha)+|lol|lmao)\b/i.test(t)) f.add(hash('flag:laugh'));
  if (t === t.toLowerCase()) f.add(hash('flag:lower'));
  if (/\b[A-Z]{4,}\b/.test(t)) f.add(hash('flag:caps'));
  for (const [k, re] of Object.entries(LEX)) if (re.test(t)) f.add(hash('lex:' + k));
  f.add(hash('bias'));
  return [...f];
}

// Scale so a long message and a short one push the weights equally hard.
function dot(w, x) { let a = 0; for (const k of x) a += w[k]; return a / Math.sqrt(x.length); }

function softmax(z) {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

function trainHead(X, y, classes, opts) {
  const K = classes.length;
  const W = Array.from({ length: K }, () => new Float64Array(DIM));
  const idx = X.map((_, i) => i);
  const epochs = opts.epochs || 20;
  const l2 = opts.l2 || 1e-4;
  // Class weights so a dominant label does not drown the rare ones.
  const counts = classes.map((c) => y.filter((v) => v === c).length || 1);
  const cw = opts.balance ? counts.map((n) => Math.sqrt(y.length / (K * n))) : counts.map(() => 1);
  for (let ep = 0; ep < epochs; ep++) {
    const lr = (opts.lr || 0.5) / (1 + ep * 0.1);
    for (let j = idx.length - 1; j > 0; j--) { const r = Math.floor(opts.rand() * (j + 1)); [idx[j], idx[r]] = [idx[r], idx[j]]; }
    for (const i of idx) {
      const x = X[i]; const yi = classes.indexOf(y[i]);
      if (yi < 0) continue;
      const p = softmax(W.map((w) => dot(w, x)));
      const sc = 1 / Math.sqrt(x.length);
      for (let k = 0; k < K; k++) {
        const g = (p[k] - (k === yi ? 1 : 0)) * cw[yi] * sc;
        const w = W[k];
        for (const f of x) w[f] -= lr * (g + l2 * w[f]);
      }
    }
  }
  return W;
}

function trainValence(X, v, opts) {
  const w = new Float64Array(DIM);
  for (let ep = 0; ep < (opts.epochs || 25); ep++) {
    const lr = 0.3 / (1 + ep * 0.1);
    for (let i = 0; i < X.length; i++) {
      const x = X[i]; const sc = 1 / Math.sqrt(x.length);
      const err = dot(w, x) - v[i];
      for (const f of x) w[f] -= lr * (err * sc + 1e-4 * w[f]);
    }
  }
  return w;
}

function sparse(arr) { const o = {}; arr.forEach((v, i) => { if (Math.abs(v) > 1e-4) o[i] = Math.round(v * 1e4) / 1e4; }); return o; }
function dense(o) { const a = new Float64Array(DIM); for (const [k, v] of Object.entries(o)) a[k] = v; return a; }

function seeded(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5 >>> 0) / 4294967296); }

/**
 * @param rows  [{ text, mood, register, target, valence }]
 * @returns     serializable model
 */
function train(rows, opts = {}) {
  const rand = seeded(opts.seed || 7);
  const X = rows.map((r) => featurize(r.text));
  const model = { version: 1, dim: DIM, trainedOn: rows.length, trainedAt: new Date().toISOString(), heads: {} };
  const val = (r, h) => (h === 'polarity' ? polarityOf(r.mood) : r[h]);
  for (const h of HEADS) {
    const classes = [...new Set(rows.map((r) => val(r, h)).filter(Boolean))].sort();
    const W = trainHead(X, rows.map((r) => val(r, h)), classes, { ...opts, rand });
    model.heads[h] = { classes, W: W.map(sparse) };
  }
  model.valence = sparse(trainValence(X, rows.map((r) => r.valence || 0), opts));
  return model;
}

/** Turn a saved model into a fast scorer: text -> { mood, register, target, valence, conf }. */
function load(model) {
  const heads = {};
  for (const [h, m] of Object.entries(model.heads)) heads[h] = { classes: m.classes, W: m.W.map(dense) };
  const vw = dense(model.valence);
  return (text) => {
    const x = featurize(text);
    const out = {};
    let conf = 1;
    for (const [h, m] of Object.entries(heads)) {
      const p = softmax(m.W.map((w) => dot(w, x)));
      let best = 0; for (let k = 1; k < p.length; k++) if (p[k] > p[best]) best = k;
      out[h] = m.classes[best];
      if (h === 'mood') conf = p[best];
    }
    out.valence = Math.max(-1, Math.min(1, Math.round(dot(vw, x) * 100) / 100));
    out.conf = Math.round(conf * 100) / 100;
    return out;
  };
}

/** Agreement between the student and held-out teacher labels, per head, plus the majority-class floor. */
function evaluate(score, rows) {
  const r = { n: rows.length };
  const truth = (x, h) => (h === 'polarity' ? polarityOf(x.mood) : x[h]);
  for (const h of HEADS) {
    const hit = rows.filter((x) => score(x.text)[h] === truth(x, h)).length;
    const counts = {}; for (const x of rows) counts[truth(x, h)] = (counts[truth(x, h)] || 0) + 1;
    r[h] = { agree: Math.round((hit / rows.length) * 1000) / 1000, majority: Math.round((Math.max(...Object.values(counts)) / rows.length) * 1000) / 1000 };
  }
  const err = rows.reduce((a, x) => a + Math.abs(score(x.text).valence - (x.valence || 0)), 0) / rows.length;
  r.valence = { meanAbsError: Math.round(err * 1000) / 1000 };
  return r;
}

module.exports = { train, load, evaluate, featurize, polarityOf, HEADS, DIM };
