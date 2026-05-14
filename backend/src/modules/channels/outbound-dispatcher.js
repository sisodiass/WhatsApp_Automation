// Per-channel outbound dispatcher. Called from the outgoing-messages
// worker after it determines a message is ready to send. Decides where
// to send it based on the chat's channel:
//
//   WHATSAPP     → existing path (publish to redis wa:outbound; wa-worker
//                   handles + acks via wa:outbound-ack which lands in
//                   markOutboundSent and sets messages.sent_at)
//   INSTAGRAM    → POST to Graph API /me/messages with the page access
//   FB_MESSENGER   token. On success we mark messages.sent_at directly
//                   (no separate ack process). On failure we mark FAILED
//                   via markOutboundSent({ok:false}).
//   WEB_CHAT     → no-op send (the widget polls /api/widget/v1/messages
//                   and picks the message up). We mark sent_at directly.
//
// Idempotency: still relies on the messages.sent_at IS NULL guard from
// the worker; this dispatcher never sends twice for the same messageId
// because the worker has already filtered "already sent" before calling.

import { child } from "../../shared/logger.js";
import { Channels, publish } from "../whatsapp/whatsapp.bus.js";
import { toWaJid } from "../../utils/phone.js";
import { markOutboundSent } from "../sessions/session.service.js";

const log = child("outbound-dispatcher");

// Returns "handled" (true) when the dispatcher fully owns the send, or
// "delegate" (false) when the caller should fall through to the legacy
// WhatsApp publish path. Keeping this seam during M10 means we don't
// need to refactor outgoing.worker.js — it tries the dispatcher first
// and falls back if dispatcher returns false.
export async function dispatchOutbound({ msg, chat, channel, typingMs }) {
  const type = channel?.type || "WHATSAPP"; // legacy chats may have null channel
  switch (type) {
    case "WEB_CHAT":
      return sendViaWebChat({ msg });
    case "INSTAGRAM":
    case "FB_MESSENGER":
      return sendViaMeta({ msg, chat, channel });
    default:
      // Fall through to WhatsApp path. We still publish here (rather
      // than returning false) so the dispatcher is the single source
      // of truth — the worker just calls dispatchOutbound and trusts.
      return sendViaWhatsApp({ msg, chat, typingMs });
  }
}

async function sendViaWhatsApp({ msg, chat, typingMs }) {
  await publish(Channels.OUTBOUND, {
    messageId: msg.id,
    to: toWaJid(chat.phone),
    body: msg.body,
    simulateTyping: Math.round(typingMs || 0),
  });
  // Ack arrives async from wa-worker → markOutboundSent. No-op here.
  return { ok: true, channel: "WHATSAPP", deferred: true };
}

async function sendViaWebChat({ msg }) {
  // The widget polls /api/widget/v1/messages and picks the row up on
  // its own. We just record the send synchronously so the message
  // shows up in the Inbox as "sent" too. Pass ok=true with no
  // waMessageId — the regular sent-at + ai-count logic runs as usual.
  await markOutboundSent({ messageId: msg.id, waMessageId: null, ok: true });
  return { ok: true, channel: "WEB_CHAT" };
}

// Meta Graph API send. `channel.config.pageAccessToken` is required.
// Recipient id is encoded in chat.phone as `meta_<type>_<senderId>` —
// we extract the trailing senderId.
async function sendViaMeta({ msg, chat, channel }) {
  const token = channel.config?.pageAccessToken;
  if (!token) {
    const reason = `no pageAccessToken on ${channel.type} channel`;
    log.warn("meta send skipped", { msgId: msg.id, reason });
    await markOutboundSent({ messageId: msg.id, ok: false, error: reason });
    return { ok: false, channel: channel.type, reason };
  }
  const recipientId = extractMetaSenderId(chat.phone);
  if (!recipientId) {
    const reason = `chat.phone does not encode a meta recipient id (${chat.phone})`;
    log.error("meta send malformed recipient", { msgId: msg.id, reason });
    await markOutboundSent({ messageId: msg.id, ok: false, error: reason });
    return { ok: false, channel: channel.type, reason };
  }
  // Graph API: POST https://graph.facebook.com/v19.0/me/messages?access_token=...
  // Body: { recipient: { id }, message: { text } }
  // Distinguishing IG vs Messenger is done by the page access token's
  // associated page — same endpoint shape for both.
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(token)}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_type: "RESPONSE",
        recipient: { id: recipientId },
        message: { text: msg.body },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const reason = data?.error?.message || `HTTP ${r.status}`;
      log.warn("meta send failed", { msgId: msg.id, status: r.status, reason });
      await markOutboundSent({ messageId: msg.id, ok: false, error: reason });
      return { ok: false, channel: channel.type, reason };
    }
    await markOutboundSent({
      messageId: msg.id,
      waMessageId: data?.message_id || null,
      ok: true,
    });
    return { ok: true, channel: channel.type, providerMid: data?.message_id || null };
  } catch (err) {
    log.error("meta send threw", { msgId: msg.id, err: err.message });
    await markOutboundSent({ messageId: msg.id, ok: false, error: err.message });
    return { ok: false, channel: channel.type, reason: err.message };
  }
}

// chat.phone = `meta_<type>_<senderId>` for meta channels.
// Returns null for non-meta chats.
function extractMetaSenderId(phone) {
  if (!phone) return null;
  const m = /^meta_(instagram|fb_messenger)_(.+)$/i.exec(phone);
  return m ? m[2] : null;
}
