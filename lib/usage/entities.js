'use strict';
/**
 * Who and what a message is about.
 * - project: from the session's working folder, with config overrides.
 * - people:  names and aliases from the vault's people file plus config.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tokens } = require('./features');

// First names that are also everyday words; matching them would tag half the messages.
const COMMON = new Set(['will', 'may', 'june', 'april', 'joy', 'faith', 'hope', 'grace', 'mark', 'bill', 'art', 'sky', 'rose', 'max', 'ray', 'dean', 'page', 'chase', 'hunter', 'lane', 'sage', 'rich', 'bob', 'ace', 'jet']);

/**
 * Parse a people markdown file. Reads tables whose first header is "Person"
 * and `## Name - note` headings. Cell formats handled: "Dave (David Marquez)",
 * "Gee / G", "A, B", `Jessibel ("Jess")`; values with "@" are dropped.
 */
function parsePeople(md) {
  const people = [];
  const add = (names) => {
    const clean = names.map((n) => n.replace(/["*_`]/g, '').trim()).filter((n) => n && !n.includes('@'));
    if (!clean.length) return;
    const aliases = new Set();
    for (const n of clean) {
      aliases.add(n);
      const first = n.split(/\s+/)[0];
      if (first && first !== n) aliases.add(first);
    }
    people.push({ name: clean[0], aliases: [...aliases] });
  };
  let inTable = false;
  for (const raw of String(md).split('\n')) {
    const line = raw.trim();
    const h = line.match(/^\|\s*Person\s*\|\s*([^|]*)\|/i);
    if (h) { inTable = !/\bhow\b|\bwrites?\b/i.test(h[1]); continue; }
    if (inTable && /^\|[\s-|]+\|$/.test(line)) continue;
    if (inTable && line.startsWith('|')) {
      const cell = line.split('|')[1] || '';
      for (const person of cell.split(/,(?![^(]*\))/)) {
        const names = [];
        const paren = person.match(/^([^(]+)\(([^)]*)\)/);
        const head = paren ? paren[1] : person;
        for (const n of head.split(' / ')) names.push(n);
        if (paren) for (const n of paren[2].split(/[,/]/)) names.push(n);
        add(names);
      }
      continue;
    }
    if (!line.startsWith('|')) inTable = false;
    const hd = line.match(/^##\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3})\s+-\s/);
    if (hd) add([hd[1]]);
  }
  return people;
}

function loadPeople(c) {
  let list = [];
  try { if (c.peopleFile) list = parsePeople(fs.readFileSync(c.peopleFile, 'utf8')); } catch { /* no people file */ }
  for (const [name, al] of Object.entries(c.aliases || {})) {
    const hit = list.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (hit) hit.aliases.push(...al); else list.push({ name, aliases: [name, ...al] });
  }
  const index = new Map(); // alias (lowercase, may be multi-word) -> canonical name
  for (const p of list) {
    for (const a of p.aliases) {
      const k = a.toLowerCase();
      if (k.length < 3 || COMMON.has(k)) continue;
      if (!index.has(k)) index.set(k, p.name);
    }
  }
  return { list, index };
}

/** Canonical names mentioned in `text`. Multi-word aliases match as phrases. */
function peopleIn(text, people) {
  if (!people || !people.index.size) return [];
  const toks = tokens(text);
  const found = new Set();
  const joined = ' ' + toks.join(' ') + ' ';
  for (const [alias, name] of people.index) {
    if (alias.includes(' ') ? joined.includes(' ' + alias + ' ') : toks.includes(alias)) found.add(name);
  }
  return [...found];
}

/**
 * Project label for a working folder. Config `usage.projectPaths` maps a path
 * prefix to a label; otherwise the folder name, with worktrees folded into
 * their repo and scratch or home folders grouped.
 */
function projectOf(cwd, c) {
  const p = String(cwd || '');
  if (!p) return '(none)';
  const map = (c && c.projectPaths) || {};
  let best = '';
  for (const prefix of Object.keys(map)) if (p.startsWith(prefix) && prefix.length > best.length) best = prefix;
  if (best) return map[best];
  const wt = p.split(/[\\/]\.claude[\\/]worktrees[\\/]/)[0];
  if (wt === os.homedir()) return '(home)';
  if (/^\/(private\/)?(tmp|var\/folders)\//.test(wt) || /scratch/i.test(wt)) return '(scratch)';
  if (/[\\/]Codex[\\/]\d{4}-\d{2}-\d{2}[\\/]/.test(wt)) return '(codex chats)';
  return path.basename(wt);
}

/**
 * Project names you might type, mapped to one label: config projects (key +
 * label), usage.projectAliases, and the labels projectPaths produce.
 */
function loadProjects(c) {
  const index = new Map();
  const add = (alias, label) => { const k = String(alias).toLowerCase().trim(); if (k.length >= 3 && !COMMON.has(k) && !index.has(k)) index.set(k, label); };
  for (const [label, al] of Object.entries(c.projectAliases || {})) { add(label, label); for (const a of al) add(a, label); }
  for (const p of c.projects || []) {
    const label = p.label || p.key;
    add(label, label); add(p.key, label);
    for (const part of String(label).split('/')) add(part, label);
  }
  for (const label of Object.values(c.projectPaths || {})) add(label, label);
  return index;
}

/** Map a folder-derived name onto the canonical label when an alias knows it. */
function canon(name, index) { return (index && index.get(String(name).toLowerCase())) || name; }

function projectsIn(text, index) {
  if (!index || !index.size) return [];
  const toks = tokens(text);
  const joined = ' ' + toks.join(' ') + ' ';
  const found = new Set();
  for (const [alias, label] of index) if (alias.includes(' ') ? joined.includes(' ' + alias + ' ') : toks.includes(alias)) found.add(label);
  return [...found];
}

module.exports = { parsePeople, loadPeople, peopleIn, projectOf, loadProjects, projectsIn, canon };
