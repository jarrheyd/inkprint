'use strict';
/**
 * Codex rollout records -> usage events. Same event shape as parse-claude.
 * A session counts as the person's when Codex marks it thread_source "user"
 * and it was not started by `codex exec` (scheduled runs); guardian reviews,
 * subagents and exec runs are the OS layer.
 */
const { classify } = require('./layer');

function parseRecord(d, state, opts = {}, lineKey = '') {
  const out = [];
  if (!d || typeof d !== 'object') return out;
  const p = d.payload || {};

  if (d.type === 'session_meta') {
    state.session = p.id || p.session_id || state.session;
    if (p.cwd) state.cwd = p.cwd;
    const human = p.thread_source === 'user' && p.originator !== 'codex_exec';
    state.sessionLayer = human ? 'you' : 'os';
    return out;
  }
  if (d.type === 'turn_context') {
    if (p.cwd) state.cwd = p.cwd;
    if (p.model) state.model = p.model;
    return out;
  }
  const base = { tool: 'codex', session: state.session, project: state.cwd || '' };
  const layer = state.sessionLayer || 'you';

  if (d.type === 'response_item' && p.type === 'message' && p.role === 'user') {
    const kept = [];
    let sawOs = false;
    for (const c of p.content || []) {
      if (!c || (c.type !== 'input_text' && c.type !== 'text')) continue;
      const r = classify(c.text, opts);
      if (r.layer === 'you') kept.push(r.text);
      if (r.layer === 'os') { sawOs = true; kept.push(r.text); }
    }
    const text = kept.join('\n').trim();
    if (!text) return out;
    const l = layer === 'os' || sawOs ? 'os' : 'you';
    out.push({ id: `x:${state.session}:${d.ordinal != null ? d.ordinal : lineKey}`, ts: d.timestamp, ...base, kind: 'prompt', layer: l, sessionLayer: layer, text });
    return out;
  }

  if (d.type === 'token_usage_record') {
    const u = p.usage || {};
    out.push({
      id: 'm:' + (p.response_id || `${state.session}:${lineKey}`), ts: d.timestamp, ...base, kind: 'model', sessionLayer: layer,
      model: state.model || '', in: Math.max(0, (u.input_tokens || 0) - (u.cached_input_tokens || 0)), out: u.output_tokens || 0,
      cacheRead: u.cached_input_tokens || 0, cacheWrite: u.cache_write_input_tokens || 0,
    });
    return out;
  }

  if (d.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) {
    out.push({ id: 't:' + (p.call_id || `${state.session}:${lineKey}`), ts: d.timestamp, ...base, kind: 'tool', sessionLayer: layer, name: p.name || '' });
  }
  return out;
}

module.exports = { parseRecord };
