'use strict';
/**
 * Everything the dashboard shows, computed from the event files with plain
 * arithmetic. No model calls. Input: events (+ local terms and people tags).
 */
const { projectOf, loadProjects, canon } = require('./entities');

// USD per million tokens. Cache read/write default to 0.1x / 1.25x input.
// Longest matching prefix wins; config usage.prices overrides or extends.
const PRICES = {
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25 },
  'claude-fable-5': { in: 10, out: 50 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-sonnet-4': { in: 3, out: 15 },
  'claude-haiku-4': { in: 1, out: 5 },
};

function priceFor(model, extra) {
  const table = { ...PRICES, ...(extra || {}) };
  const id = String(model || '').replace(/\[.*\]$/, '');
  let best = '';
  for (const k of Object.keys(table)) if (id.startsWith(k) && k.length > best.length) best = k;
  if (!best) return null;
  const p = table[best];
  return { in: p.in, out: p.out, cacheRead: p.cacheRead != null ? p.cacheRead : p.in * 0.1, cacheWrite: p.cacheWrite != null ? p.cacheWrite : p.in * 1.25 };
}

function costOf(e, extra) {
  const p = priceFor(e.model, extra);
  if (!p) return null;
  return (e.in * p.in + e.out * p.out + e.cacheRead * p.cacheRead + e.cacheWrite * p.cacheWrite) / 1e6;
}

function localParts(tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return (ts) => {
    const o = {};
    for (const p of f.formatToParts(new Date(ts))) o[p.type] = p.value;
    return { day: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour) % 24, dow: DOW[o.weekday] };
  };
}

function isoWeek(day) {
  const d = new Date(day + 'T00:00:00Z');
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)));
  const y = t.getUTCFullYear();
  const w = 1 + Math.round(((t - Date.UTC(y, 0, 4)) / 864e5 - 3 + ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

function addDays(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function inc(o, k, n = 1) { o[k] = (o[k] || 0) + n; }
function top(o, n) { return Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n); }
function round(x, d = 3) { const f = 10 ** d; return Math.round(x * f) / f; }

const IDLE_MIN = 30;

/** Style profile for a set of "you" prompts; used for the baseline and for every context. */
function profile(list, parts, langNames) {
  const n = list.length || 1;
  const words = list.map((e) => e.words || 0);
  const r = {
    n: list.length,
    avgWords: round(words.reduce((a, b) => a + b, 0) / n, 1),
    medianWords: median(words),
    correction: round(list.filter((e) => e.correction).length / n),
    question: round(list.filter((e) => e.question).length / n),
    laugh: round(list.filter((e) => e.laugh).length / n),
    lower: round(list.filter((e) => e.lower).length / n),
    shout: round(list.filter((e) => e.shout).length / n),
    late: round(list.filter((e) => { const h = parts(e.ts).hour; return h >= 22 || h < 5; }).length / n),
  };
  const totalWords = words.reduce((a, b) => a + b, 0) || 1;
  for (const name of langNames) r['lang:' + name] = round(list.reduce((a, e) => a + ((e.langs && e.langs[name]) || 0), 0) / totalWords);
  if (list.some((e) => e.tone)) {
    const toned = list.filter((e) => e.tone);
    const moods = {};
    for (const e of toned) inc(moods, e.tone.mood);
    r.moods = Object.fromEntries(Object.entries(moods).map(([k, v]) => [k, round(v / toned.length)]));
    r.valence = round(toned.reduce((a, e) => a + (e.tone.valence || 0), 0) / toned.length);
    r.neg = round(toned.filter((e) => e.tone.polarity === 'neg').length / toned.length);
    r.pos = round(toned.filter((e) => e.tone.polarity === 'pos').length / toned.length);
  }
  return r;
}

/** "3.0x as often", "about half as often": ratios people say out loud. */
function howOften(lift) {
  if (lift >= 1) return `${lift.toFixed(1)}x as often`;
  if (lift <= 0.28) return 'about a quarter as often';
  if (lift <= 0.38) return 'about a third as often';
  if (lift <= 0.58) return 'about half as often';
  return `${Math.round((1 - lift) * 100)}% less often`;
}

const METRIC_TEXT = {
  medianWords: ['write', 'longer messages', 'shorter messages', (v) => `${Math.round(v)} words`],
  correction: ['push back', 'more', 'less', (v) => `${Math.round(v * 100)}%`],
  question: ['ask questions', 'more', 'less', (v) => `${Math.round(v * 100)}%`],
  laugh: ['laugh', 'more', 'less', (v) => `${Math.round(v * 100)}%`],
  late: ['work late (10pm-5am)', 'more', 'less', (v) => `${Math.round(v * 100)}%`],
  shout: ['use CAPS', 'more', 'less', (v) => `${Math.round(v * 100)}%`],
  neg: ['sound tense', 'more', 'less', (v) => `${Math.round(v * 100)}%`],
  pos: ['sound upbeat', 'more', 'less', (v) => `${Math.round(v * 100)}%`],
};

// Short verb phrases for one combined sentence per context.
const PHRASE = {
  medianWords: ['write longer', 'write shorter'],
  correction: ['push back more', 'push back less'],
  question: ['ask more questions', 'ask fewer questions'],
  laugh: ['laugh more', 'laugh less'],
  late: ['work late more often', 'work late less often'],
  shout: ['use caps more', 'use caps less'],
  neg: ['sound tense more often', 'sound tense less often'],
  pos: ['sound upbeat more often', 'sound upbeat less often'],
};

/**
 * One sentence per project or person, joining its strongest differences:
 * "When Dana comes up, you write longer (81 words vs 13) and ask more questions (47% vs 20%)."
 */
function combine(diffList, max = 3) {
  const by = new Map();
  for (const d of diffList) {
    const k = d.kind + '|' + d.name;
    if (!by.has(k)) by.set(k, { kind: d.kind, name: d.name, items: [] });
    by.get(k).items.push(d);
  }
  const strength = (d) => Math.abs(Math.log(d.lift || 1));
  const out = [];
  for (const g of by.values()) {
    g.items.sort((a, b) => strength(b) - strength(a));
    g.items = g.items.slice(0, max);
    const parts = g.items.map((d) => {
      const up = d.value > d.base;
      const words = d.metric.startsWith('lang:') ? [`use ${d.metric.slice(5)} more`, `use ${d.metric.slice(5)} less`] : PHRASE[d.metric];
      const nums = d.metric === 'medianWords' ? `${Math.round(d.value)} words vs ${Math.round(d.base)}` : `${Math.round(d.value * 100)}% vs ${Math.round(d.base * 100)}%`;
      return `${words[up ? 0 : 1]} (${nums})`;
    });
    const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
    const lead = g.kind === 'person' ? `When ${g.name} comes up, you` : `On ${g.name}, you`;
    out.push({ ...g, strength: strength(g.items[0]), text: `${lead} ${list}.` });
  }
  return out.sort((a, b) => b.strength - a.strength);
}

/** Where a context departs from your baseline, strongest first. */
function diffs(kind, name, p, base, langNames, minN) {
  const out = [];
  if (p.n < minN) return out;
  const keys = Object.keys(METRIC_TEXT).concat(langNames.map((l) => 'lang:' + l));
  for (const k of keys) {
    const v = p[k]; const b = base[k];
    if (v == null || b == null) continue;
    if (b < 0.01 && k !== 'medianWords') continue;
    if (k !== 'medianWords' && Math.abs(v - b) < 0.03) continue; // 1% vs 2% is a big ratio and no real difference
    const lift = b ? v / b : 0;
    if (lift < 1.6 && lift > 0.6) continue;
    let text;
    if (k.startsWith('lang:')) text = `On ${name} you use ${k.slice(5)} ${howOften(lift)} (${Math.round(v * 100)}% of words vs ${Math.round(b * 100)}% usually)`;
    else {
      const [verb, up, down, fmt] = METRIC_TEXT[k];
      text = k === 'medianWords'
        ? `On ${name} you write ${lift > 1 ? up : down}: ${fmt(v)} vs ${fmt(b)} usually`
        : `On ${name} you ${verb} ${howOften(lift)} (${fmt(v)} vs ${fmt(b)} usually)`;
    }
    out.push({ kind, name, metric: k, value: v, base: b, lift: round(lift, 2), text });
  }
  return out;
}

/**
 * @param events  all rows from events/
 * @param local   { terms: rows, people: rows } from local.nosync (may be empty)
 * @param c       usage config (timezone, projectPaths, languages, prices)
 */
function compute(events, local, c) {
  const tz = c.timezone || 'UTC';
  const parts = localParts(tz);
  const langNames = Object.keys(c.languages || {});
  const prompts = events.filter((e) => e.kind === 'prompt').sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const you = prompts.filter((e) => e.layer === 'you');

  // Project per prompt. A normal folder is its own project. A hub folder (the
  // vault, home, one-off chat folders) carries many projects, so there the
  // session takes the project its messages name most, and a message that
  // names a project directly counts for that one.
  const pIndex = loadProjects(c);
  const hubs = (c.hubPaths || []).filter(Boolean);
  const isHub = (cwd) => hubs.some((h) => cwd === h || String(cwd).startsWith(h + '/')) || /^\((home|codex chats|scratch|none)\)$/.test(projectOf(cwd, c));
  const sessProj = new Map();
  {
    const votes = new Map();
    for (const e of you) {
      if (!votes.has(e.session)) votes.set(e.session, { cwd: e.project, n: {} });
      for (const a of e.about || []) inc(votes.get(e.session).n, a);
    }
    for (const [sid, v] of votes) {
      if (!isHub(v.cwd)) { sessProj.set(sid, canon(projectOf(v.cwd, c), pIndex)); continue; }
      const best = top(v.n, 1)[0];
      sessProj.set(sid, best ? best[0] : '(no single project)');
    }
  }
  const projById = new Map();
  for (const e of you) {
    const sp = sessProj.get(e.session) || '(no single project)';
    const about = e.about || [];
    projById.set(e.id, isHub(e.project) && about.length && !about.includes(sp) ? about[0] : sp);
  }
  // Running your day (your OS itself, general sessions) is not a project: it gets one row, last.
  const DAY = 'Day to day';
  const dayLabels = new Set(['(no single project)', ...(c.dayToDay || [])]);
  const projOfPrompt = (e) => { const p = projById.get(e.id) || '(no single project)'; return dayLabels.has(p) ? DAY : p; };
  const tonesById = new Map((local.tones || []).map((t) => [t.id, t]));
  for (const e of you) { const t = tonesById.get(e.id); if (t) e.tone = t; }

  // Days, streaks, heatmap, hour x weekday.
  const daily = {};
  const hourDow = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const e of you) {
    const p = parts(e.ts);
    const d = daily[p.day] || (daily[p.day] = { day: p.day, prompts: 0, words: 0, claude: 0, codex: 0, sessions: new Set() });
    d.prompts++; d.words += e.words || 0; d[e.tool]++; d.sessions.add(e.session);
    hourDow[p.dow][p.hour]++;
  }
  const days = Object.keys(daily).sort();
  const first = days[0] || null;
  const today = parts(new Date().toISOString()).day;
  const series = [];
  if (first) for (let d = first; d <= today; d = addDays(d, 1)) {
    const x = daily[d];
    series.push({ day: d, prompts: x ? x.prompts : 0, words: x ? x.words : 0, claude: x ? x.claude : 0, codex: x ? x.codex : 0, sessions: x ? x.sessions.size : 0 });
  }
  let longest = 0; let run = 0;
  for (const s of series) { run = s.prompts ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].prompts) current++;
    else if (i === series.length - 1) continue; // today not started yet does not break the streak
    else break;
  }

  // Sessions and active time. Gaps over IDLE_MIN do not count as time.
  const bySession = new Map();
  for (const e of you) { if (!bySession.has(e.session)) bySession.set(e.session, []); bySession.get(e.session).push(e); }
  const sessionLens = []; const sessionMsgs = [];
  const projectMinutes = {};
  for (const list of bySession.values()) {
    let mins = 1;
    for (let i = 1; i < list.length; i++) {
      const gap = (Date.parse(list[i].ts) - Date.parse(list[i - 1].ts)) / 60000;
      mins += gap > IDLE_MIN ? 1 : Math.max(gap, 0.5);
    }
    sessionLens.push(mins); sessionMsgs.push(list.length);
    for (const [name, share] of Object.entries(list.reduce((o, e) => { inc(o, projOfPrompt(e), 1 / list.length); return o; }, {}))) inc(projectMinutes, name, mins * share);
  }

  // Projects with weekly trend.
  const projects = {};
  for (const e of you) {
    const name = projOfPrompt(e);
    const p = projects[name] || (projects[name] = { name, prompts: 0, words: 0, weeks: {}, tools: {} });
    p.prompts++; p.words += e.words || 0; inc(p.weeks, isoWeek(parts(e.ts).day)); inc(p.tools, e.tool);
  }
  const weeks = [...new Set(series.map((s) => isoWeek(s.day)))];
  const weekStart = {};
  for (const x of series) { const w = isoWeek(x.day); if (!weekStart[w]) weekStart[w] = x.day; }
  const moodWeeks = weeks.map((w) => ({ week: w, start: weekStart[w], neg: 0, flat: 0, pos: 0 }));
  const moodDays = {};
  for (const e of you) {
    if (!e.tone || !e.tone.polarity) continue;
    const day = parts(e.ts).day;
    const mw = moodWeeks[weeks.indexOf(isoWeek(day))];
    if (mw) mw[e.tone.polarity]++;
    const md = moodDays[day] || (moodDays[day] = { neg: 0, flat: 0, pos: 0 });
    md[e.tone.polarity]++;
  }
  const projectList = Object.values(projects).map((p) => ({
    name: p.name, prompts: p.prompts, words: p.words, minutes: Math.round(projectMinutes[p.name] || 0), tools: p.tools,
    weekly: weeks.map((w) => p.weeks[w] || 0),
    day: p.name === DAY,
  })).sort((a, b) => (a.day - b.day) || b.minutes - a.minutes || b.prompts - a.prompts);

  // Words (local-only data).
  const termCount = {}; const bigramCount = {};
  const youIds = new Set(you.map((e) => e.id));
  for (const t of local.terms || []) {
    if (!youIds.has(t.id)) continue;
    for (const w of t.terms || []) inc(termCount, w);
    for (const b of t.bigrams || []) inc(bigramCount, b);
  }
  const particles = {};
  for (const e of you) for (const [k, v] of Object.entries(e.particles || {})) inc(particles, k, v);
  const corrections = you.filter((e) => e.correction);
  const base = profile(you, parts, langNames);

  // Contexts: projects and people.
  const contextDiffs = [];
  const projectProfiles = {};
  for (const p of projectList) {
    const list = you.filter((e) => projOfPrompt(e) === p.name);
    projectProfiles[p.name] = profile(list, parts, langNames);
    if (!p.day) contextDiffs.push(...diffs('project', p.name, projectProfiles[p.name], base, langNames, 25));
  }
  const peopleById = new Map((local.people || []).map((r) => [r.id, r.people]));
  const byPerson = {};
  for (const e of you) for (const name of peopleById.get(e.id) || []) (byPerson[name] || (byPerson[name] = [])).push(e);
  const people = Object.entries(byPerson).map(([name, list]) => {
    const pr = profile(list, parts, langNames);
    contextDiffs.push(...diffs('person', name, pr, base, langNames, 12));
    const w = {}; for (const e of list) inc(w, isoWeek(parts(e.ts).day));
    const withProj = {}; for (const e of list) inc(withProj, projOfPrompt(e));
    return { name, mentions: list.length, profile: pr, weekly: weeks.map((x) => w[x] || 0), projects: top(withProj, 3) };
  }).sort((a, b) => b.mentions - a.mentions);
  contextDiffs.sort((a, b) => Math.abs(Math.log(b.lift || 1)) - Math.abs(Math.log(a.lift || 1)));

  // Hour-of-day style: how you write by time block.
  const blocks = { 'morning (5-12)': [], 'afternoon (12-18)': [], 'evening (18-22)': [], 'late (22-5)': [] };
  for (const e of you) {
    const h = parts(e.ts).hour;
    blocks[h >= 5 && h < 12 ? 'morning (5-12)' : h >= 12 && h < 18 ? 'afternoon (12-18)' : h >= 18 && h < 22 ? 'evening (18-22)' : 'late (22-5)'].push(e);
  }
  const timeProfiles = Object.fromEntries(Object.entries(blocks).map(([k, l]) => [k, profile(l, parts, langNames)]));

  // Machine side: tokens, cost, models, tools, split by layer.
  const models = {}; const costDaily = {}; const tools = { you: {}, os: {} };
  const layerTotals = { you: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 }, os: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 } };
  let unpriced = 0;
  for (const e of events) {
    const layer = e.sessionLayer === 'os' ? 'os' : 'you';
    if (e.kind === 'model') {
      const cost = costOf(e, c.prices);
      if (cost == null) unpriced += e.in + e.out;
      const m = models[e.model] || (models[e.model] = { model: e.model, tool: e.tool, calls: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, cost: 0, priced: cost != null });
      m.calls += e.calls || 1; m.in += e.in; m.out += e.out; m.cacheRead += e.cacheRead; m.cacheWrite += e.cacheWrite; m.cost += cost || 0;
      const L = layerTotals[layer];
      L.calls += e.calls || 1; L.in += e.in; L.out += e.out; L.cacheRead += e.cacheRead; L.cacheWrite += e.cacheWrite; L.cost += cost || 0;
      const day = parts(e.ts).day;
      const cd = costDaily[day] || (costDaily[day] = { day, you: 0, os: 0 });
      cd[layer] += cost || 0;
    } else if (e.kind === 'tool') {
      for (const [k, v] of Object.entries(e.tools || {})) inc(tools[layer], k, v);
    }
  }
  const osPrompts = prompts.filter((e) => e.layer === 'os');
  const osSessions = new Set(events.filter((e) => e.sessionLayer === 'os').map((e) => e.session));

  // This week against the four full weeks before it.
  const thisWeek = (() => {
    const cur = isoWeek(today);
    const idx = weeks.indexOf(cur);
    const prev = weeks.slice(Math.max(0, idx - 4), Math.max(0, idx));
    const pick = (w) => you.filter((e) => isoWeek(parts(e.ts).day) === w);
    const stat = (list) => {
      const pr = profile(list, parts, langNames);
      const days = new Set(list.map((e) => parts(e.ts).day)).size;
      return { messages: list.length, activeDays: days, medianWords: pr.medianWords, correction: pr.correction, question: pr.question, late: pr.late, neg: pr.neg == null ? null : pr.neg };
    };
    const now = stat(pick(cur));
    const before = prev.map((w) => stat(pick(w)));
    const avg = (k) => { const v = before.map((b) => b[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const base = { messages: avg('messages'), activeDays: avg('activeDays'), medianWords: avg('medianWords'), correction: avg('correction'), question: avg('question'), late: avg('late'), neg: avg('neg') };
    const moved = [];
    const dayOfWeek = (parts(new Date().toISOString()).dow ?? 6) + 1; // 1 = Monday
    if (base.messages && prev.length) {
      const pace = now.messages / dayOfWeek * 7;
      const r = pace / base.messages;
      if (r >= 1.25 || r <= 0.75) moved.push({ metric: 'messages', text: `You're on pace for ${Math.round(pace)} messages this week, ${r > 1 ? `${Math.round((r - 1) * 100)}% more` : `${Math.round((1 - r) * 100)}% fewer`} than your ${prev.length}-week average of ${Math.round(base.messages)}.` });
    }
    const rate = (k, label) => {
      if (base[k] == null || now[k] == null || now.messages < 15) return;
      const d = now[k] - base[k];
      if (Math.abs(d) >= 0.04) moved.push({ metric: k, text: `This week ${label} ${Math.round(now[k] * 100)}% of the time, against ${Math.round(base[k] * 100)}% over the last ${prev.length} weeks.` });
    };
    rate('neg', 'you sounded tense');
    rate('correction', 'you pushed back');
    rate('late', 'you worked late');
    rate('question', 'you asked questions');
    const byProj = {};
    for (const e of pick(cur)) inc(byProj, projOfPrompt(e));
    return { week: cur, start: weekStart[cur] || today, now, base, weeksCompared: prev.length, moved, topProjects: top(byProj, 3), today: (daily[today] && daily[today].prompts) || 0 };
  })();

  return {
    generated: new Date().toISOString(),
    thisWeek,
    tz,
    range: { from: first, to: today },
    you: {
      prompts: you.length,
      words: you.reduce((a, e) => a + (e.words || 0), 0),
      sessions: bySession.size,
      activeDays: days.length,
      streak: { current, longest },
      byTool: { claude: you.filter((e) => e.tool === 'claude').length, codex: you.filter((e) => e.tool === 'codex').length },
      series,
      hourDow,
      session: { medianMinutes: round(median(sessionLens), 1), medianPrompts: median(sessionMsgs), hours: Math.round(sessionLens.reduce((a, b) => a + b, 0) / 60) },
    },
    projects: projectList,
    projectProfiles,
    words: {
      top: top(termCount, 60),
      bigrams: top(bigramCount, 40),
      particles: top(particles, 30),
      correctionMedianWords: median(corrections.map((e) => e.words || 0)),
      base,
      timeProfiles,
    },
    contexts: { diffs: contextDiffs.slice(0, 40), combined: combine(contextDiffs) },
    mood: { weeks: moodWeeks, days: moodDays, scored: you.filter((e) => e.tone).length },
    people,
    machine: {
      layers: Object.fromEntries(Object.entries(layerTotals).map(([k, v]) => [k, { ...v, cost: round(v.cost, 2) }])),
      models: Object.values(models).map((m) => ({ ...m, cost: round(m.cost, 2) })).sort((a, b) => b.cost - a.cost || b.out - a.out),
      costDaily: Object.values(costDaily).sort((a, b) => (a.day < b.day ? -1 : 1)).map((d) => ({ day: d.day, you: round(d.you, 2), os: round(d.os, 2) })),
      tools: { you: top(tools.you, 20), os: top(tools.os, 20) },
      osPrompts: osPrompts.length,
      osSessions: osSessions.size,
      unpricedTokens: unpriced,
    },
  };
}

module.exports = { combine, compute, priceFor, costOf, isoWeek, localParts, profile, diffs, PRICES };
