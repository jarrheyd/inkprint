'use strict';
/**
 * The teacher: a small model labels a sample of messages so the local
 * classifier can learn them. Each tool labels only its own messages:
 * Claude Code text goes to `claude -p`, Codex text goes to `codex exec`.
 * Every call is logged to model/spend.jsonl.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MOODS = ['focused', 'curious', 'playful', 'pleased', 'frustrated', 'stressed', 'neutral'];
const REGISTERS = ['casual', 'direct', 'formal'];
const TARGETS = ['ai', 'work', 'person', 'self'];

const SYSTEM = `You label short messages a person typed to an AI coding and work assistant.
For each message return:
- mood: ${MOODS.join(', ')}. "focused" = getting work done, calm. "neutral" = no feeling shows. "frustrated" = annoyed at something not working or being wrong. "stressed" = time pressure or worry. "pleased" = happy with a result. "playful" = joking, teasing. "curious" = exploring or wondering.
- valence: -1 (very negative) to 1 (very positive), 0 when flat.
- register: casual (lowercase, slang, loose), direct (plain instructions), formal (polished, full sentences).
- target: who or what the feeling is about. ai = the assistant or its output, work = a task, product, or client project, person = a named human, self = the writer themselves.
Judge only the text. Short acks like "yes" or "go" are focused/neutral with valence 0. Return one label per message, keyed by its number.`;

const SCHEMA = {
  type: 'object',
  properties: {
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          mood: { type: 'string', enum: MOODS },
          valence: { type: 'number' },
          register: { type: 'string', enum: REGISTERS },
          target: { type: 'string', enum: TARGETS },
        },
        required: ['i', 'mood', 'valence', 'register', 'target'],
        additionalProperties: false,
      },
    },
  },
  required: ['labels'],
  additionalProperties: false,
};

function prompt(batch) {
  return 'Messages:\n' + batch.map((m, i) => `[${i}] ${m.text.replace(/\s+/g, ' ').slice(0, 320)}`).join('\n');
}

function logSpend(spendFile, row) {
  try { fs.mkdirSync(path.dirname(spendFile), { recursive: true }); fs.appendFileSync(spendFile, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n'); } catch { /* best effort */ }
}

function viaClaude(batch, opts) {
  const out = execFileSync('claude', [
    '-p', '--model', opts.claudeModel || 'haiku', '--no-session-persistence', '--strict-mcp-config',
    '--setting-sources', '', '--settings', '{"disableAllHooks":true,"alwaysThinkingEnabled":false}', '--tools', '',
    '--system-prompt', SYSTEM, '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA),
  ], { input: prompt(batch), cwd: os.tmpdir(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 300000 });
  const d = JSON.parse(out);
  if (d.is_error) throw new Error('claude: ' + String(d.result).slice(0, 200));
  const usage = Object.values(d.modelUsage || {})[0] || {};
  logSpend(opts.spendFile, { tool: 'claude', job: opts.job, n: batch.length, in: (usage.inputTokens || 0) + (usage.cacheCreationInputTokens || 0) + (usage.cacheReadInputTokens || 0), out: usage.outputTokens || 0 });
  return (d.structured_output || JSON.parse(d.result)).labels;
}

function viaCodex(batch, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-teach-'));
  const schemaFile = path.join(dir, 'schema.json');
  const outFile = path.join(dir, 'out.json');
  fs.writeFileSync(schemaFile, JSON.stringify(SCHEMA));
  const args = ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-c', 'model_reasoning_effort=low', '--output-schema', schemaFile, '-o', outFile];
  if (opts.codexModel) args.push('-m', opts.codexModel);
  args.push(SYSTEM + '\n\n' + prompt(batch));
  try {
    execFileSync(opts.codexBin || 'codex', args, { cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
    const labels = JSON.parse(fs.readFileSync(outFile, 'utf8')).labels;
    logSpend(opts.spendFile, { tool: 'codex', job: opts.job, n: batch.length });
    return labels;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Label messages in batches with the tool that produced them.
 * @param msgs  [{ id, tool, text }]
 * @returns     [{ id, tool, mood, valence, register, target }]
 */
function label(msgs, opts = {}) {
  const out = [];
  for (const tool of ['claude', 'codex']) {
    // Codex carries a fixed ~20k-token overhead per call, so it gets one big batch.
    const size = tool === 'codex' ? (opts.codexBatch || 100) : (opts.batch || 80);
    const mine = msgs.filter((m) => m.tool === tool);
    for (let i = 0; i < mine.length; i += size) {
      const batch = mine.slice(i, i + size);
      let labels = [];
      try { labels = tool === 'claude' ? viaClaude(batch, opts) : viaCodex(batch, opts); } catch (e) {
        if (opts.onError) opts.onError(tool, e); continue;
      }
      for (const l of labels || []) {
        const m = batch[l.i];
        if (!m) continue;
        out.push({ id: m.id, ts: m.ts, tool, mood: l.mood, valence: Math.max(-1, Math.min(1, Number(l.valence) || 0)), register: l.register, target: l.target });
      }
      if (opts.onBatch) opts.onBatch(tool, out.length);
    }
  }
  return out;
}

module.exports = { label, MOODS, REGISTERS, TARGETS, SYSTEM, SCHEMA };
