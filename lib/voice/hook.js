#!/usr/bin/env node
'use strict';
/**
 * PreToolUse hook for draft and send tools. Works out the channel and the
 * recipient from the tool call, checks the draft against your voice card,
 * and blocks (exit 2, reason on stderr) when it's out of your range on 2+
 * measures. Anything it can't place passes. Bypass: DISABLE_VOICE_CHECK=1.
 */
const BODY_KEYS = ['body', 'htmlBody', 'message', 'text', 'content', 'message_body', 'comment', 'commentBody'];
const MAIL_KEYS = ['subject', 'threadId', 'replyToMessageId', 'cc', 'bcc'];

function channelOf(tool, input) {
  const t = String(tool || '').toLowerCase();
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

function bodyOf(input) {
  for (const k of BODY_KEYS) {
    const v = input && input[k];
    if (typeof v === 'string' && v.trim()) return k === 'htmlBody' ? v.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '') : v;
  }
  return '';
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
  const text = bodyOf(input);
  if (!channel || !text.trim()) process.exit(0);
  let r;
  try { r = require('./check').run(channel, recipientOf(input), text); } catch { process.exit(0); }
  if (!r.block) process.exit(0);
  process.stderr.write(require('./check').format(r) + '\n');
  process.exit(2);
}

module.exports = { channelOf, bodyOf, recipientOf, main };
if (require.main === module) main();
