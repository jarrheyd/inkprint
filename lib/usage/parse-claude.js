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
// An assistant turn that hands you something to send: a quoted or fenced draft of a message, email or post.
const DRAFT = /\b(draft|reply|message|email|post|caption|dm|note to)\b[\s\S]{0,400}(```|^>|\n>|\u201c|"[^"\n]{20,})/im;

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
    if (toolResult) {
      // Results of tools the AI ran: your own sent messages get harvested from them.
      if (opts.onToolResult && state.pending) {
        for (const b of d.message.content) {
          if (!b || b.type !== 'tool_result' || !state.pending[b.tool_use_id]) continue;
          const { name, input } = state.pending[b.tool_use_id];
          delete state.pending[b.tool_use_id];
          const body = Array.isArray(b.content) ? b.content.map((x) => (x && x.text) || '').join('\n') : String(b.content || '');
          const rows = opts.onToolResult(name, input, body);
          if (rows && rows.length) out.push({ kind: 'harvest', rows, ts: d.timestamp });
        }
      }
      return out;
    }
    const origin = (d.origin && d.origin.kind) || '';
    const c = classify(text, opts);
    if (c.layer === 'drop') return out;
    if (autoSession || d.promptSource === 'system' || origin === 'task-notification' || origin === 'peer') c.layer = 'os';
    if (!state.sessionLayer) state.sessionLayer = autoSession ? 'os' : c.layer;
    const ev = { id: d.uuid, ts: d.timestamp, ...base, kind: 'prompt', layer: c.layer, sessionLayer: state.sessionLayer, text: c.text };
    if (state.lastDraft && state.lastDraft.session === state.session) ev.afterDraft = true; // you're answering a draft the AI just wrote
    state.lastDraft = null;
    out.push(ev);
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
      if (c && c.type === 'text' && DRAFT.test(c.text || '')) state.lastDraft = { session: state.session };
      if (c && c.type === 'tool_use' && opts.onToolResult) {
        state.pending = state.pending || {};
        state.pending[c.id] = { name: c.name, input: c.input };
        if (opts.onToolUse) opts.onToolUse(c.name, c.input);
        if (opts.onAiSend && opts.sendTool && opts.sendTool.test(c.name || '')) opts.onAiSend(c.input);
        const keys = Object.keys(state.pending);
        if (keys.length > 40) delete state.pending[keys[0]]; // results arrive right after their call; keep the state small
      }
      if (c && c.type === 'tool_use') {
        out.push({ id: 't:' + (c.id || d.uuid), ts: d.timestamp, ...base, kind: 'tool', sessionLayer: layer, name: c.name || '' });
      }
    }
  }
  return out;
}

module.exports = { parseRecord, textOf };
