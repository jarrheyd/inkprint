#!/usr/bin/env node
'use strict';
/**
 * PreToolUse hook for draft and send tools. Works out the channel and the
 * recipient from the tool call, checks the draft against your voice card,
 * and blocks (exit 2, reason on stderr) when it's out of your range on 2+
 * measures. Documents leaving the machine (Drive, Docs, Slides, Artifacts)
 * are checked for words only. A word warning pauses the call once: the same
 * text sent again goes through. Anything it can't place passes.
 * Bypass: DISABLE_VOICE_CHECK=1.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BODY_KEYS = ['body', 'htmlBody', 'message', 'text', 'content', 'message_body', 'comment', 'commentBody'];
const DOC_TOOL = /(^|__)(create_file|update_doc|update_document|update_presentation|batch_update)$/;
const WARNED_MAX = 500;
const MAIL_KEYS = ['subject', 'threadId', 'replyToMessageId', 'cc', 'bcc'];

function channelOf(tool, input) {
  const t = String(tool || '').toLowerCase();
  if (t === 'artifact') return !input || !input.action || input.action === 'publish' ? 'doc' : null;
  if (DOC_TOOL.test(t)) return 'doc';
  if (/gmail|outlook/.test(t)) return 'email';
  if (/discord/.test(t)) return 'discord';
  if (/teams/.test(t)) return 'teams';
  if (/telegram/.test(t)) return 'telegram';
  if (/whatsapp/.test(t)) return 'whatsapp';
  if (/google.?chat|gchat/.test(t)) return 'gchat';
  if (/slack/.test(t)) return 'slack';
  if (MAIL_KEYS.some((k) => input && input[k] != null) || (input && input.to && BODY_KEYS.some((k) => input[k]))) return 'email';
  return null;
}

function stripHtml(v) {
  return String(v).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h[1-6]|li|tr|div)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"');
}

/** The words of a document on its way out: uploaded text, text typed into a Doc or deck, or the page being published. */
function docBody(input) {
  if (!input) return '';
  if (typeof input.textContent === 'string') return /<[a-z][\s\S]*>/i.test(input.textContent) ? stripHtml(input.textContent) : input.textContent;
  if (Array.isArray(input.requests)) {
    return input.requests.map((r) => (r && ((r.insertText && r.insertText.text) || (r.replaceAllText && r.replaceAllText.replaceText))) || '').filter(Boolean).join('\n');
  }
  if (typeof input.file_path === 'string' && /\.(html?|md|txt)$/i.test(input.file_path)) {
    try { const t = fs.readFileSync(input.file_path, 'utf8'); return /\.html?$/i.test(input.file_path) ? stripHtml(t) : t; } catch { return ''; }
  }
  return '';
}

function bodyOf(input, channel) {
  if (channel === 'doc') return docBody(input);
  for (const k of BODY_KEYS) {
    const v = input && input[k];
    if (typeof v === 'string' && v.trim()) return k === 'htmlBody' ? v.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '') : v;
  }
  return '';
}

/** True the first time this exact text shows up with word warnings; the next time it has been seen. */
function firstWarning(text) {
  let file;
  try { const { loadUsageConfig } = require('../config'); file = path.join(require('./sends').dirs(loadUsageConfig().dir).cards, 'warned.json'); } catch { return false; }
  const key = crypto.createHash('sha1').update(String(text).replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first one */ }
  if (seen.includes(key)) return false;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify([...seen, key].slice(-WARNED_MAX))); } catch { return false; } // can't remember it: don't pause
  return true;
}

/** "Alex Tan <alex@x.co>" -> "Alex Tan"; chat ids and names pass through. */
function recipientOf(input) {
  const v = input && (input.to || input.recipient || input.chat_name || input.chatName || input.chat || input.contact || input.username);
  const first = Array.isArray(v) ? v[0] : v;
  if (!first) return '';
  const s = String(first);
  const m = s.match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1] : s.replace(/@.*$/, '').replace(/[._]/g, ' ');
}

function main() {
  if (process.env.DISABLE_VOICE_CHECK === '1') process.exit(0);
  let data;
  try { data = JSON.parse(require('fs').readFileSync(0, 'utf8')); } catch { process.exit(0); }
  const input = data.tool_input || {};
  const channel = channelOf(data.tool_name, input);
  const text = bodyOf(input, channel);
  if (!channel || !text.trim()) process.exit(0);
  const ck = require('./check');
  let r;
  try { r = ck.run(channel, recipientOf(input), text); } catch { process.exit(0); }
  if (r.block) { process.stderr.write(ck.format(r) + '\n'); process.exit(2); }
  // Word warnings never block for good: show them once, then the same text goes through.
  if (r.findings.some((f) => f.kind === 'word') && firstWarning(text)) {
    process.stderr.write(ck.format(r) + '\nThese are words you rarely use. Change them, or send the same text again and it goes through.\n');
    process.exit(2);
  }
  process.exit(0);
}

module.exports = { channelOf, bodyOf, docBody, recipientOf, firstWarning, main };
if (require.main === module) main();
