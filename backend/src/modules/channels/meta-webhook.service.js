// Meta webhook ingestion (Instagram + FB Messenger). Translates the
// webhook payload into the project's standard Chat / ChatSession /
// Message tables so the rest of the system (Inbox, agent replies,
// follow-ups, automations) works for these channels too.
//
// Inbound flow:
//   1. Caller's route verifies the X-Hub-Signature-256 against the
//      channel's appSecret before this service is invoked.
//   2. We iterate entry[].messaging[]; each message becomes one Chat
//      row (keyed by `meta_<senderId>` on chat.phone, mirroring the
//      web-chat ephemeral-id pattern) + a Session + Message.
//   3. No campaign-tag matching (Meta has no notion of campaign tags).
//   4. AI replies are NOT auto-enabled on Meta inbound — the lead lands
//      MANUAL by default. Future iteration can attach a default campaign
//      with KB groups; for v1 agents reply manually.

import crypto from "node:crypto";
import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { emitChatMessage } from "../../shared/socket.js";
import { ensureLeadForContact } from "../leads/lead.service.js";

const log = child("meta-webhook");

// Verify the X-Hub-Signature-256 header against the raw request body.
// Returns true on match (constant-time). Caller is responsible for
// providing the raw bytes — Express's express.json() loses them.
export function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader) return false;
  // Header is "sha256=<hex>".
  const m = /^sha256=([a-f0-9]+)$/i.exec(signatureHeader);
  if (!m) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(m[1], "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Handle a verified Meta webhook payload for the given channel. Returns
// a summary of work done — useful for tests + the smoke probe.
export async function handleMetaWebhook(channel, payload) {
  if (!payload?.entry?.length) return { received: 0 };
  let processed = 0;
  let skipped = 0;
  for (const entry of payload.entry) {
    const events = entry.messaging || [];
    for (const ev of events) {
      try {
        if (await handleMessagingEvent(channel, ev)) processed += 1;
        else skipped += 1;
      } catch (err) {
        log.error("messaging event failed", {
          channelId: channel.id, err: err.message,
        });
        skipped += 1;
      }
    }
  }
  return { received: processed + skipped, processed, skipped };
}

async function handleMessagingEvent(channel, ev) {
  // We handle inbound text messages only in v1. Quick-replies, postbacks,
  // delivery / read receipts are no-ops (logged but skipped) — extending
  // is a matter of adding a switch branch here.
  const senderId = ev.sender?.id;
  if (!senderId) return false;
  if (!ev.message) return false;
  // Echo of our own outbound — Meta delivers these too. Ignore.
  if (ev.message.is_echo) return false;
  const text = ev.message.text;
  if (!text) return false;
  // Per-message dedup: Meta retries deliver the same `mid`. We use the
  // existing messages.waMessageId column as a unique key (it's just a
  // "provider message id" — the name predates Meta support).
  const providerMid = ev.message.mid || null;
  if (providerMid) {
    const existing = await prisma.message.findUnique({
      where: { waMessageId: providerMid },
      select: { id: true },
    });
    if (existing) return false; // already ingested
  }

  // Find or create the chat. Phone-format key: `meta_<channel-type>_<sender>`.
  const phoneKey = `meta_${channel.type.toLowerCase()}_${senderId}`;
  let chat = await prisma.chat.findUnique({
    where: { tenantId_phone: { tenantId: channel.tenantId, phone: phoneKey } },
  });
  if (!chat) {
    chat = await prisma.chat.create({
      data: {
        tenantId: channel.tenantId,
        phone: phoneKey,
        channelId: channel.id,
        displayName: null, // Meta doesn't ship a name in the webhook
      },
    });
    // Also create a Contact identity so the Inbox + Pipeline work.
    const contactSource = channel.type === "INSTAGRAM" ? "instagram" : "facebook_messenger";
    const contact = await prisma.contact.create({
      data: {
        tenantId: channel.tenantId,
        mobile: phoneKey,
        source: contactSource,
      },
    });
    await prisma.chat.update({
      where: { id: chat.id },
      data: { contactId: contact.id, lastMessageAt: new Date() },
    });
    chat.contactId = contact.id;
    // Auto-create a Lead through the central helper. Idempotent — if
    // another path already created a lead for this contact (unlikely
    // on fresh Meta inbound but possible if the operator imported the
    // contact first), we keep the existing one.
    await ensureLeadForContact(channel.tenantId, contact.id, contactSource).catch((err) =>
      log.warn("ensureLeadForContact failed (continuing)", { contactId: contact.id, err: err.message }),
    );
  } else if (chat.channelId !== channel.id) {
    // Backfill the channel link if the chat predates the channels table.
    await prisma.chat.update({
      where: { id: chat.id },
      data: { channelId: channel.id },
    });
  }

  // Open (or reuse) an active session. Meta inbound sessions stay in
  // MANUAL by default — no campaign tag means no auto-AI path.
  let session = await prisma.chatSession.findFirst({
    where: { chatId: chat.id, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!session) {
    session = await prisma.chatSession.create({
      data: { chatId: chat.id, state: "ACTIVE", mode: "MANUAL" },
    });
  }

  const msg = await prisma.message.create({
    data: {
      sessionId: session.id,
      direction: "IN",
      source: "CUSTOMER",
      body: text,
      kbChunkIds: [],
      waMessageId: providerMid, // unique-indexed; doubles as Meta dedup key
    },
  });
  await prisma.chat.update({
    where: { id: chat.id },
    data: { lastMessageAt: new Date() },
  });

  emitChatMessage({
    id: msg.id,
    sessionId: msg.sessionId,
    chatId: chat.id,
    direction: msg.direction,
    source: msg.source,
    body: msg.body,
    createdAt: msg.createdAt,
  });

  log.info("ingested meta inbound", {
    channel: channel.type, senderId, msgId: msg.id, providerMid,
  });
  return true;
}
