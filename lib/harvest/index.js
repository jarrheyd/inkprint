'use strict';
/**
 * Your own sent messages, found in tool results your AI already fetched.
 * When a session reads your Gmail, Discord, Telegram, WhatsApp, Google Chat
 * or Teams, the result sits in the transcript. These adapters keep only the
 * messages you sent and drop everyone else's. Unknown tools are skipped.
 *
 * Each adapter: (name, input, text, self) -> [{ channel, chat, to, ts, text }]
 * `self` = { names: Set(lowercase), emails: Set, discordIds: Set }
 */

const LINE = /^\[(\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?)\] (.*)$/;

function isoOf(ts) {
  const s = String(ts || '').trim().replace(' ', 'T');
  if (!s) return '';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
  return isNaN(d) ? '' : d.toISOString();
}

/** Messages in "[time] Sender: text" form, with continuation lines joined. */
function lines(text, meta = /^\s{2,}(thread|spaces|reactions?|attachment|media)\b/i) {
  const out = [];
  let cur = null;
  for (const raw of String(text).split('\n')) {
    const m = raw.match(LINE);
    if (m) { if (cur) out.push(cur); cur = { ts: m[1], rest: m[2] }; continue; }
    if (cur && raw.trim() && !meta.test(raw)) cur.rest += '\n' + raw.replace(/^\s{4}/, '');
  }
  if (cur) out.push(cur);
  return out;
}

function splitSender(rest) {
  const i = rest.indexOf(': ');
  return i < 0 ? null : { sender: rest.slice(0, i).trim(), text: rest.slice(i + 2).trim() };
}

function isSelfName(name, self) {
  const n = String(name || '').toLowerCase().replace(/<[^>]*>/, '').trim();
  if (!n) return false;
  if (self.names.has(n)) return true;
  const email = (String(name).match(/<([^>]+)>/) || [])[1];
  return !!email && self.emails.has(email.toLowerCase());
}

/** Drop quoted history from an email body: "On ... wrote:" and ">" lines onward. */
function ownEmailText(body) {
  let t = String(body || '');
  // Quoted history can sit on its own line or run inline after your text.
  const cut = t.search(/\s*On (Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? [^\n]{4,120}?(wrote:|<[^>\s]+@[^>\s]+>)|\s*-{2,}\s*(Original|Forwarded) Message|\n\s*>/i);
  if (cut >= 0) t = t.slice(0, cut);
  return t.trim();
}

/** Clean a chat message for voice stats: no bare mentions, no media placeholders. */
function tidy(text) {
  const t = String(text || '').trim();
  if (/^\[(image|video|audio|document|sticker|gif|file)\b/i.test(t)) return '';
  const words = t.replace(/<@!?&?\d+>/g, '').replace(/@\d{6,}/g, '').trim();
  return words ? t : '';
}

const adapters = [
  {
    // Gmail connectors: search_threads / get_thread return JSON with sender + plaintextBody.
    match: (n) => /(search_threads|get_thread|gmail_read_email|gmail_search_emails)$/.test(n),
    parse(n, input, text, self) {
      let j; try { j = JSON.parse(text); } catch { return []; }
      const msgs = [].concat(j.messages || [], ...(j.threads || []).map((t) => t.messages || []));
      return msgs.filter((m) => m && typeof m === 'object' && (isSelfName(m.sender || m.from, self) || [...self.emails].some((e) => String(m.sender || m.from || '').toLowerCase().includes(e))) && (m.plaintextBody || m.body))
        .map((m) => ({ channel: 'email', chat: m.subject || '', to: String((m.toRecipients || [])[0] || m.to || '').replace(/<.*$/, '').trim(), ts: isoOf(m.date || (m.internalDate && new Date(Number(m.internalDate)).toISOString())), text: ownEmailText(m.plaintextBody || m.body) }))
        .filter((r) => r.text);
    },
  },
  {
    // Discord (JSON servers): messages with author { id, username }.
    match: (n) => /discord_(read_messages|search_messages)$/.test(n),
    parse(n, input, text, self) {
      let j; try { j = JSON.parse(text); } catch { return []; }
      const flat = [].concat(...(j.messages || []).map((m) => (Array.isArray(m) ? m : [m])));
      return flat.filter((m) => m && m.author && (self.discordIds.has(String(m.author.id)) || isSelfName(m.author.global_name || m.author.username, self)) && m.content)
        .map((m) => ({ channel: 'discord', chat: String(m.channel_id || j.channelId || input.channelId || ''), to: '', ts: isoOf(m.timestamp), text: m.content }));
    },
  },
  {
    // Line-based chat readers: Discord (text servers), Telegram, Google Chat.
    match: (n) => /(__Discord__(read_channel|search_channel)|__[Tt]elegram__(read_chat|search_messages)|google-chat-ro__(list_messages|get_thread|search_messages))$/.test(n),
    parse(n, input, text, self) {
      const channel = /discord/i.test(n) ? 'discord' : /telegram/i.test(n) ? 'telegram' : 'gchat';
      const chat = String(input.chat || input.channel || input.space || '');
      const out = [];
      for (const m of lines(text)) {
        let s = splitSender(m.rest);
        if (!s) continue;
        // Telegram search results carry the chat title before the sender.
        if (channel === 'telegram' && !isSelfName(s.sender, self)) { const inner = splitSender(s.text); if (inner && isSelfName(inner.sender, self)) s = { sender: inner.sender, text: inner.text, chat: s.sender }; }
        if (!isSelfName(s.sender, self) || !s.text) continue;
        out.push({ channel, chat: s.chat || chat, to: '', ts: isoOf(m.ts), text: s.text });
      }
      return out;
    },
  },
  {
    // whatsapp-ro list_messages: "[time] Chat: <name> From: Me: <text>".
    match: (n) => /whatsapp[^_]*__list_messages$/.test(n),
    parse(n, input, text) {
      const out = [];
      for (const m of lines(text)) {
        const x = m.rest.match(/^Chat: (.*?) From: (.*?): ([\s\S]*)$/);
        if (x && /^me$/i.test(x[2].trim()) && x[3].trim()) out.push({ channel: 'whatsapp', chat: x[1], to: '', ts: isoOf(m.ts), text: x[3].trim() });
      }
      return out;
    },
  },
  {
    // Microsoft Teams search: JSON records with from { displayName, email } and summary.
    match: (n) => /(chat_message_search|teams_list_channel_messages)$/.test(n),
    parse(n, input, text, self) {
      const out = [];
      const recs = String(text).match(/\{[^{}]*"from"\s*:\s*\{[^{}]*\}[^{}]*\}/g) || [];
      for (const r of recs) {
        let j; try { j = JSON.parse(r); } catch { continue; }
        const f = j.from || {};
        if (!(isSelfName(f.displayName, self) || (f.email && self.emails.has(String(f.email).toLowerCase())))) continue;
        const body = String(j.summary || j.body || '').replace(/<[^>]+>/g, '').trim();
        if (body) out.push({ channel: 'teams', chat: j.chatId || '', to: '', ts: isoOf(j.createdDateTime), text: body });
      }
      return out;
    },
  },
];

function harvest(toolName, input, text, self) {
  const n = String(toolName || '');
  for (const a of adapters) {
    if (!a.match(n)) continue;
    try { return a.parse(n, input || {}, String(text || ''), self).map((r) => ({ ...r, text: r.channel === 'email' ? r.text : tidy(r.text) })).filter((r) => r.text && !/saved messages/i.test(r.chat || '')); } catch { return []; }
  }
  return [];
}

// Tools your AI uses to send or draft for you; what goes through them is AI-written, not your voice.
const SEND_TOOL = /(send_message|send_email|reply|forward|create_draft|update_draft|discord_send|discord_reply_to_forum|discord_create_forum_post|gmail_draft|gmail_send_email|outlook_send_mail|outlook_create_draft|teams_send_chat_message|teams_send_channel_message|teams_reply_channel_message|slack_post_message)$/;

/** Your ids, learned from how you search: a Discord authorId you filter by is yours. */
function learnFromInput(toolName, input, self) {
  if (/discord_search_messages$/.test(String(toolName)) && input && input.authorId) self.discordIds.add(String(input.authorId));
}

module.exports = { harvest, learnFromInput, lines, ownEmailText, tidy, isoOf, adapters, SEND_TOOL };
