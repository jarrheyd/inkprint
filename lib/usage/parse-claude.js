'use strict';
/**
 * Claude Code transcript records -> usage events. Stateless per line except
 * for a small per-file state object (session layer, cwd) the caller persists
 * between incremental reads. Prompt events carry `text` in memory only; the
 * ingester turns it into features and never writes it to disk.
 */
const { classify } = require('./layer');

function textOf(content) {
  if (typeof content === 'string') return { text: content, toolResult: false };
  if (!Array.isArray(content)) return { text: '', toolResult: false };
  let toolResult = false;
  const parts = [];
  for (const c of content) {
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'tool_result') toolResult = true;
    if (c.type === 'text') parts.push(c.text || '');
  }
  return { text: parts.join('\n'), toolResult };
}

/**
 * @param state  mutable per-file state: { subagent, session, cwd, sessionLayer }
 * @param opts   { osPrefixes }
 */
function parseRecord(d, state, opts = {}) {
  const out = [];
  if (!d || typeof d !== 'object') return out;
  if (d.cwd) state.cwd = d.cwd;
  if (d.sessionId) state.session = d.sessionId;
  const base = { tool: 'claude', session: state.session, project: state.cwd || '' };
  const autoSession = !!(state.subagent || d.isSidechain);

  if (d.type === 'user') {
    if (d.isMeta || d.isCompactSummary || d.isVisibleInTranscriptOnly) return out;
    const { text, toolResult } = textOf(d.message && d.message.content);
    if (toolResult) return out;
    const origin = (d.origin && d.origin.kind) || '';
    const c = classify(text, opts);
    if (c.layer === 'drop') return out;
    if (autoSession || d.promptSource === 'system' || origin === 'task-notification' || origin === 'peer') c.layer = 'os';
    if (!state.sessionLayer) state.sessionLayer = autoSession ? 'os' : c.layer;
    out.push({ id: d.uuid, ts: d.timestamp, ...base, kind: 'prompt', layer: c.layer, sessionLayer: state.sessionLayer, text: c.text });
    return out;
  }

  if (d.type === 'assistant' && d.message) {
    const m = d.message;
    const layer = state.sessionLayer || (autoSession ? 'os' : 'you');
    if (m.id && m.usage && m.model && m.model !== '<synthetic>') {
      const u = m.usage;
      out.push({
        id: 'm:' + m.id, ts: d.timestamp, ...base, kind: 'model', sessionLayer: layer, model: m.model,
        in: u.input_tokens || 0, out: u.output_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0,
      });
    }
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c && c.type === 'tool_use') {
        out.push({ id: 't:' + (c.id || d.uuid), ts: d.timestamp, ...base, kind: 'tool', sessionLayer: layer, name: c.name || '' });
      }
    }
  }
  return out;
}

module.exports = { parseRecord, textOf };
