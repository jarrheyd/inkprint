'use strict';
/**
 * File store. Numbers go to `events/YYYY-MM.jsonl` (safe to sync). Anything
 * derived from message words goes to `local.nosync/` (iCloud skips *.nosync).
 * Lines are append-only; readers keep the last line per id.
 */
const fs = require('fs');
const path = require('path');

function monthOf(ts) { return String(ts || '').slice(0, 7) || 'unknown'; }

function appendGrouped(dir, rows) {
  const byMonth = new Map();
  for (const r of rows) {
    const m = monthOf(r.ts);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(JSON.stringify(r));
  }
  if (!byMonth.size) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const [m, lines] of byMonth) fs.appendFileSync(path.join(dir, m + '.jsonl'), lines.join('\n') + '\n');
}

function readAll(dir) {
  const byId = new Map();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort(); } catch { return []; }
  for (const f of files) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const line of txt.split('\n')) {
      if (!line) continue;
      try { const r = JSON.parse(line); byId.set(r.id, r); } catch { /* torn line */ }
    }
  }
  return [...byId.values()];
}

function paths(usageDir) {
  const local = path.join(usageDir, 'local.nosync');
  return {
    events: path.join(usageDir, 'events'),
    cursor: path.join(usageDir, 'cursor.json'),
    local,
    terms: path.join(local, 'terms'),
    people: path.join(local, 'people'),
    tones: path.join(local, 'tones'),
    model: path.join(local, 'tone-model.json'),
  };
}

module.exports = { appendGrouped, readAll, paths, monthOf };
