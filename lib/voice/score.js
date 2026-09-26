'use strict';
/**
 * Score a draft against a voice card. Each finding names what you usually
 * do in that channel and what the draft does. A finding is "hard" when the
 * draft sits outside your usual range (p10-p90, or a habit you follow at
 * least 80% of the time). The caller blocks on 2+ hard findings when the
 * card is built from enough sends.
 */
const { sendStats, GREETING, SIGNOFF } = require('./card');

function pct(x) { return `${Math.round((x || 0) * 100)}%`; }

/** Chat drafts: one line or paragraph per send. Email: the whole draft is one send. */
function splitDraft(text, channel) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (channel === 'email') return [t];
  return t.split(/\n+/).map((x) => x.trim()).filter(Boolean);
}

function check(draft, card, opts = {}) {
  const channel = card.channel;
  const sends = splitDraft(draft, channel);
  const findings = [];
  if (!sends.length) return { findings, hard: 0, sends: 0 };
  const stats = sends.map(sendStats);
  const where = card.label || channel;
  const add = (hard, text) => findings.push({ hard, text });

  // Length.
  const longest = Math.max(...stats.map((s) => s.words));
  if (longest > card.words.p90 * 1.25 && longest - card.words.p90 >= 6) {
    add(true, `Your sends on ${where} run ${card.words.p50} words typical and rarely past ${card.words.p90}; this draft has a ${longest}-word ${channel === 'email' ? 'email' : 'send'}.`);
  }

  // Splitting one thought into several sends (chat only).
  if (channel !== 'email' && sends.length === 1 && stats[0].words > card.words.p90 && card.sendsPerBurst.splitShare >= 0.25) {
    add(true, `You split a thought into several short sends ${pct(card.sendsPerBurst.splitShare)} of the time on ${where}; this is one block. Break it up.`);
  }
  if (channel !== 'email' && sends.length > Math.max(card.sendsPerBurst.p90, 2) + 2) {
    add(false, `You usually send at most ${card.sendsPerBurst.p90} in a row on ${where}; this draft is ${sends.length} sends.`);
  }

  // Greeting and sign-off.
  const opensWithGreeting = GREETING.test(sends[0]);
  if (opensWithGreeting && card.greeting < 0.2) add(true, `You open with a greeting ${pct(card.greeting)} of the time on ${where}; this draft opens with "${sends[0].split(/\s+/).slice(0, 3).join(' ')}".`);
  if (!opensWithGreeting && card.greeting >= 0.8) add(true, `You open with a greeting ${pct(card.greeting)} of the time on ${where}; this draft has none.`);
  const closesWithSignoff = SIGNOFF.test(sends[sends.length - 1]);
  if (closesWithSignoff && card.signoff < 0.2) add(true, `You sign off ${pct(card.signoff)} of the time on ${where}; this draft ends with a sign-off.`);
  if (!closesWithSignoff && card.signoff >= 0.8) add(false, `You sign off ${pct(card.signoff)} of the time on ${where}; this draft doesn't.`);

  // Casing and punctuation habits.
  const lowerShare = stats.filter((s) => s.lower).length / stats.length;
  if (card.lower >= 0.7 && lowerShare < 0.3) add(true, `${pct(card.lower)} of your sends on ${where} are all lowercase; this draft is capitalized.`);
  const periodShare = stats.filter((s) => s.period).length / stats.length;
  if (card.period <= 0.15 && periodShare >= 0.5) add(true, `You end a send with a period ${pct(card.period)} of the time on ${where}; ${pct(periodShare)} of this draft's sends do.`);
  const exclaimShare = stats.filter((s) => s.exclaim).length / stats.length;
  if (card.exclaim <= 0.1 && exclaimShare >= 0.5 && sends.length > 1) add(false, `You use exclamation marks in ${pct(card.exclaim)} of sends on ${where}; this draft uses them in ${pct(exclaimShare)}.`);

  const hard = findings.filter((f) => f.hard).length;
  const minSends = opts.minSends || 30;
  const block = opts.block !== false && card.sends >= minSends && hard >= 2;
  return { findings, hard, sends: sends.length, block, cardSends: card.sends };
}

module.exports = { check, splitDraft };
