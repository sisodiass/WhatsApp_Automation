// Session engine — encodes the three rules from the spec:
//
//   1. Reset rule: a valid campaign tag + (no active session OR inactive
//      > 7 days) starts a new session. Plain inactivity NEVER resets.
//   2. Resume rule: an active session that's been idle 24h–7d gets a
//      one-shot SESSION_RESUME template before normal handling.
//   3. Counter rule: ai_reply_count is bumped only when an outbound row
//      with source=AI is committed. (Phase 5 — not exercised here.)
//
// Phase 3 ships rules 1 and 2 plus storage of inbound and SYSTEM outbound
// messages. Phase 5 wires the AI pipeline that uses the saved sessions.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { DAY, HOUR, daysBetween } from "../../utils/time.js";
import { fromWaJid } from "../../utils/phone.js";
import { findCampaignByMessageBody } from "../campaigns/campaign.service.js";
import { renderTemplate } from "../templates/template.service.js";
import { enqueueIncoming, enqueueOutbound } from "../queue/producers.js";
import { getProvider } from "../ai/providers/index.js";
import { emitChatMessage } from "../../shared/socket.js";

const log = child("session");

const PROCESSING_LOCK_MS = 30_000;

// Defaults — overridden by `settings` table once Phase 8 wires runtime
// reads. For Phase 3 we read from settings on each call (cheap because
// there are only a handful of settings).
async function getRuntimeSettings(tenantId) {
  const rows = await prisma.setting.findMany({
    where: {
      tenantId,
      key: { in: ["session.inactivity_reset_days", "session.resume_after_hours"] },
    },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    resetDays: Number(map["session.inactivity_reset_days"] ?? 7),
    resumeAfterHours: Number(map["session.resume_after_hours"] ?? 24),
  };
}

// ─── Chat upsert + processing lock ────────────────────────────────────

// `phone` is the routing identifier (could be an @lid for privacy-mode
// senders). `mobile` is the human-readable phone number we want to
// store on the CRM Contact — falls back to `phone` when WhatsApp didn't
// expose a real number. UI detects the @lid suffix on Contact.mobile
// and renders such rows as "(private)".
async function upsertChat(tenantId, phone, displayName, mobile = null) {
  const chat = await prisma.chat.upsert({
    where: { tenantId_phone: { tenantId, phone } },
    update: displayName ? { displayName } : {},
    create: { tenantId, phone, displayName },
  });
  // M1: link the chat to a CRM Contact identity (idempotent — mobile is
  // the canonical key). Done in a separate step so a contact upsert
  // failure can't poison the message ingress path; we log and continue.
  if (!chat.contactId) {
    try {
      const mobileForContact = mobile || phone;
      const contact = await prisma.contact.upsert({
        where: { tenantId_mobile: { tenantId, mobile: mobileForContact } },
        update: {},
        create: {
          tenantId,
          mobile: mobileForContact,
          ...(displayName ? splitDisplayName(displayName) : {}),
          source: "whatsapp_inbound",
        },
        select: { id: true },
      });
      await prisma.chat.update({
        where: { id: chat.id },
        data: { contactId: contact.id },
      });
      chat.contactId = contact.id;
      // Auto-create a Lead for first-contact inbound. Idempotent —
      // ensureLeadForContact short-circuits if a lead exists.
      const { ensureLeadForContact } = await import("../leads/lead.service.js");
      await ensureLeadForContact(tenantId, contact.id, "whatsapp").catch((err) =>
        log.warn("ensureLeadForContact failed (continuing)", { phone, err: err.message }),
      );
    } catch (err) {
      log.warn("contact upsert failed (continuing)", { phone, err: err.message });
    }
  }
  return chat;
}

// Best-effort split of WhatsApp notifyName into first/last.
function splitDisplayName(name) {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// Acquires a per-chat lock by atomically updating processing_lock_until.
// Returns true if we got the lock; false if another worker holds it.
async function acquireLock(chatId) {
  const now = new Date();
  const expires = new Date(now.getTime() + PROCESSING_LOCK_MS);
  const result = await prisma.chat.updateMany({
    where: {
      id: chatId,
      OR: [{ processingLockUntil: null }, { processingLockUntil: { lt: now } }],
    },
    data: { processingLockUntil: expires },
  });
  return result.count === 1;
}

async function releaseLock(chatId) {
  await prisma.chat.update({
    where: { id: chatId },
    data: { processingLockUntil: null },
  });
}

// ─── Active session helpers ───────────────────────────────────────────

function findActiveSession(chatId) {
  return prisma.chatSession.findFirst({
    where: { chatId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
}

async function endSession(sessionId, reason) {
  return prisma.chatSession.update({
    where: { id: sessionId },
    data: { endedAt: new Date(), endedReason: reason, state: "CLOSED" },
  });
}

async function startSession(chatId, campaignId) {
  const session = await prisma.chatSession.create({
    data: {
      chatId,
      campaignId,
      state: "NEW",
      mode: "AI",
      aiReplyCount: 0,
    },
  });
  await prisma.chat.update({
    where: { id: chatId },
    data: { currentSessionId: session.id },
  });
  return session;
}

// Bumps last_activity_at on the session AND last_message_at on the chat.
async function touchActivity(sessionId, chatId) {
  const now = new Date();
  await prisma.$transaction([
    prisma.chatSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: now },
    }),
    prisma.chat.update({
      where: { id: chatId },
      data: { lastMessageAt: now },
    }),
  ]);
}

// ─── Message persistence ──────────────────────────────────────────────

async function recordInbound({ sessionId, chatId, body, waMessageId }) {
  // Dedup — if wa-worker re-emits the same message id, we skip. The unique
  // index on wa_message_id makes this idempotent.
  try {
    const msg = await prisma.message.create({
      data: {
        sessionId,
        direction: "IN",
        source: "CUSTOMER",
        body,
        kbChunkIds: [],
        waMessageId: waMessageId || null,
      },
    });
    emitChatMessage({ ...msg, chatId });
    return msg;
  } catch (err) {
    if (err.code === "P2002") {
      log.warn("inbound dup skipped", { waMessageId });
      return null;
    }
    throw err;
  }
}

async function recordSystemOutbound({ sessionId, chatId, body }) {
  const msg = await prisma.message.create({
    data: {
      sessionId,
      direction: "OUT",
      source: "SYSTEM",
      body,
      kbChunkIds: [],
    },
  });
  emitChatMessage({ ...msg, chatId });
  return msg;
}

// SYSTEM messages (onboarding / resume / handoff) go through the
// outgoing-messages queue so they share the rate limiter and A3 dedup.
// No explicit delayMs — the worker's source-based logic applies the
// same randomized delay + typing simulation as AI replies, so templates
// feel human-paced instead of arriving in the same second as the trigger.
async function dispatchSystemOutbound(messageId) {
  await enqueueOutbound(messageId);
}

// ─── The engine ───────────────────────────────────────────────────────

/**
 * Handles one inbound WhatsApp message. The wa-worker has already committed
 * to delivering it; we treat it as a single unit of work.
 *
 * @param {object} ctx
 * @param {string} ctx.tenantId
 * @param {string} ctx.from   — wa jid like "919999999999@c.us" or "...@lid"
 * @param {string=} ctx.contactPhone — real phone number resolved by the
 *                                       worker via msg.getContact() when
 *                                       the JID is an @lid. null when
 *                                       WhatsApp didn't surface one.
 * @param {string} ctx.body
 * @param {string} ctx.waMessageId — used for inbound dedup
 * @param {string=} ctx.displayName
 */
export async function handleInbound(ctx) {
  const { tenantId, from, contactPhone, body, waMessageId, displayName } = ctx;
  const phone = fromWaJid(from);
  if (!phone) {
    log.debug("ignoring non-individual jid", { from });
    return { skipped: "non-individual" };
  }
  if (!body || !body.trim()) {
    log.debug("ignoring empty body", { phone });
    return { skipped: "empty" };
  }

  // Phone (routing) may be an @lid; mobile (CRM display) prefers the
  // resolved real number, falling back to the routing id so the
  // contact-mobile unique constraint still holds.
  const chat = await upsertChat(tenantId, phone, displayName, contactPhone);

  // M4: link this inbound to any recent bulk-campaign send to the same
  // contact. Best-effort: if the contact has a SENT/DELIVERED recipient
  // row within the reply window (7d), mark the most-recent one REPLIED
  // and bump the campaign's repliedCount. Fail-soft so a bulk reply
  // linking error never blocks message ingress.
  if (chat.contactId) {
    try {
      await linkInboundToBulkRecipient(chat.contactId);
    } catch (err) {
      log.warn("bulk-reply linking failed", { phone, err: err.message });
    }
  }

  const got = await acquireLock(chat.id);
  if (!got) {
    log.warn("chat busy, dropping", { chatId: chat.id, phone });
    return { skipped: "busy" };
  }

  try {
    const { resetDays, resumeAfterHours } = await getRuntimeSettings(tenantId);
    const active = await findActiveSession(chat.id);
    const campaign = await findCampaignByMessageBody(tenantId, body);
    const now = Date.now();

    // ── Path A: campaign re-entry ───────────────────────────────────
    // Either no active session, or this session has been idle longer
    // than the configured reset window.
    if (campaign) {
      const inactiveDays = active ? daysBetween(new Date(now), active.lastActivityAt) : Infinity;
      const shouldReset = !active || inactiveDays > resetDays;

      if (shouldReset) {
        if (active) await endSession(active.id, "CAMPAIGN_REENTRY");
        const session = await startSession(chat.id, campaign.id);

        await recordInbound({ sessionId: session.id, chatId: chat.id, body, waMessageId });

        const text =
          campaign.onboardingMessage ||
          (await renderTemplate(tenantId, "ONBOARDING_DEFAULT", {
            customer_name: chat.displayName || "there",
          }));
        if (text) {
          const out = await recordSystemOutbound({
            sessionId: session.id,
            chatId: chat.id,
            body: text,
          });
          await dispatchSystemOutbound(out.id);
        }
        await touchActivity(session.id, chat.id);
        log.info("campaign reentry", {
          phone,
          campaignTag: campaign.tag,
          sessionId: session.id,
          replacedSessionId: active?.id || null,
        });
        return { path: "reentry", sessionId: session.id };
      }
      // Campaign tag inside an already-active fresh session is treated as
      // a normal message — no reset, no double-onboarding.
    }

    // ── No active session and no campaign tag — drop ──────────────
    // The customer has no entry context. The product rule is: campaign
    // link is the only way in. We persist nothing (messages need a session)
    // and do not auto-respond.
    if (!active) {
      log.info("no session + no campaign — dropped", { phone });
      return { skipped: "no_entry_context" };
    }

    // ── Path B: session resume ─────────────────────────────────────
    // Active session, fresh enough not to reset, but stale enough to
    // warrant a "welcome back" cue. Fires once, then normal handling.
    const inactiveMs = now - active.lastActivityAt.getTime();
    const resumeWindowMs = resumeAfterHours * HOUR;
    const resetWindowMs = resetDays * DAY;
    const isResume = inactiveMs >= resumeWindowMs && inactiveMs < resetWindowMs;

    if (isResume) {
      const saved = await recordInbound({
        sessionId: active.id,
        chatId: chat.id,
        body,
        waMessageId,
      });
      const text = await renderTemplate(tenantId, "SESSION_RESUME");
      if (text) {
        const out = await recordSystemOutbound({
          sessionId: active.id,
          chatId: chat.id,
          body: text,
        });
        await dispatchSystemOutbound(out.id);
      }
      await touchActivity(active.id, chat.id);
      // Resume cue first, AI handling next — the customer's message likely
      // is a real question, not just a "still there?" ping.
      if (saved) await enqueueIncoming(saved.id);
      log.info("session resume", { phone, sessionId: active.id, inactiveHours: inactiveMs / HOUR });
      return { path: "resume", sessionId: active.id };
    }

    // ── Path C: normal handling ───────────────────────────────────
    // Persist the inbound, then route into the BullMQ AI pipeline. The
    // incoming-messages worker re-checks all gates (mode, ai_enabled,
    // 10-cap) before fanning out to kb-search.
    const saved = await recordInbound({
      sessionId: active.id,
      chatId: chat.id,
      body,
      waMessageId,
    });
    await touchActivity(active.id, chat.id);
    if (saved) {
      await enqueueIncoming(saved.id);
      log.info("normal inbound enqueued for AI", { phone, sessionId: active.id });
    }
    return { path: "normal", sessionId: active.id };
  } catch (err) {
    log.error("handleInbound failed", { phone, err: err.message, stack: err.stack });
    throw err;
  } finally {
    await releaseLock(chat.id).catch((err) =>
      log.error("releaseLock failed", { chatId: chat.id, err: err.message }),
    );
  }
}

// ─── Sent-ack handler (called from whatsapp.consumer) ───────────────
// Bumps ai_reply_count + snapshot fields ONLY for AI source messages
// (R10) and only after a successful send (so failed/cancelled outbounds
// don't burn a slot toward the 10-cap).

export async function markOutboundSent({ messageId, waMessageId, ok, error }) {
  if (!messageId) return;
  if (!ok) {
    log.warn("outbound failed", { messageId, error });
    // For bulk campaigns the failure path needs to land too — flip the
    // recipient to FAILED so analytics + retries are accurate.
    await markBulkRecipientFailed(messageId, error);
    return;
  }

  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      source: true,
      sessionId: true,
      confidence: true,
      sentAt: true,
      body: true,
      direction: true,
      kbChunkIds: true,
      createdAt: true,
      session: { select: { chatId: true } },
    },
  });
  if (!msg) {
    log.warn("ack for missing message", { messageId });
    return;
  }
  if (msg.sentAt) return; // dedup — already acked

  const now = new Date();

  // M4: bulk-campaign recipients ride the same ack rail. Flip the
  // recipient row + bump the campaign's denormalized sent counter when
  // the send is confirmed. AI-cap logic below stays untouched.
  if (msg.source === "CAMPAIGN") {
    await markBulkRecipientSent(messageId, now);
  }

  // What counts toward the 10-cap?
  //   - source=AI         → real AI reply
  //   - source=SYSTEM AND confidence != null → kb-search fallback (low conf
  //     or generation error). Counted because otherwise an off-topic chat
  //     could loop in fallback indefinitely.
  // What does NOT count:
  //   - source=SYSTEM with no confidence → onboarding, resume, manual
  //     handoff (the cap-escalation message itself)
  //   - source=AGENT      → human reply
  //   - source=CUSTOMER   → inbound (never marked sent here)
  const isAiAttempt = msg.source === "AI" || (msg.source === "SYSTEM" && msg.confidence !== null);

  if (isAiAttempt) {
    let providerName = null;
    try {
      providerName = (await getProvider()).name;
    } catch (err) {
      log.warn("could not resolve provider for ack stamp", { err: err.message });
    }
    await prisma.$transaction([
      prisma.message.update({
        where: { id: messageId },
        data: { sentAt: now, waMessageId: waMessageId || null },
      }),
      prisma.chatSession.update({
        where: { id: msg.sessionId },
        data: {
          aiReplyCount: { increment: 1 },
          lastAiReplyAt: now,
          lastConfidence: msg.confidence,
          aiProvider: providerName,
          state: "ACTIVE",
        },
      }),
    ]);
  } else {
    await prisma.message.update({
      where: { id: messageId },
      data: { sentAt: now, waMessageId: waMessageId || null },
    });
  }

  // Re-broadcast so any open chat panel ticks the message from "sending"
  // to "sent". The frontend dedups by message id.
  emitChatMessage({
    id: msg.id,
    sessionId: msg.sessionId,
    chatId: msg.session?.chatId,
    direction: msg.direction,
    source: msg.source,
    body: msg.body,
    confidence: msg.confidence,
    createdAt: msg.createdAt,
    sentAt: now,
  });
}

// ─── M4: bulk-campaign recipient state propagation ────────────────
// Called from markOutboundSent when the acked message has source=CAMPAIGN.
// Kept here (rather than in bulk-campaigns module) so the existing ack
// path doesn't grow new module dependencies; bulk-campaigns owns the
// state model but its rows are reachable directly via messageId.

async function markBulkRecipientSent(messageId, when) {
  const recipient = await prisma.bulkCampaignRecipient.findFirst({
    where: { messageId, status: { in: ["QUEUED", "PENDING"] } },
  });
  if (!recipient) return;
  await prisma.$transaction([
    prisma.bulkCampaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "SENT", sentAt: when },
    }),
    prisma.bulkCampaign.update({
      where: { id: recipient.bulkCampaignId },
      data: { sentCount: { increment: 1 } },
    }),
  ]);
}

// Reply window for linking inbound messages to bulk recipients. Mirrors
// the project's 7-day session-reset window so a "fresh conversation"
// after this point isn't credited to a stale bulk.
const BULK_REPLY_WINDOW_MS = 7 * DAY;

async function linkInboundToBulkRecipient(contactId) {
  const since = new Date(Date.now() - BULK_REPLY_WINDOW_MS);
  // Most-recent non-replied recipient — only flip the first match so a
  // single inbound doesn't carom across stacked bulks.
  const recipient = await prisma.bulkCampaignRecipient.findFirst({
    where: {
      contactId,
      status: { in: ["SENT", "DELIVERED", "READ"] },
      sentAt: { gte: since },
    },
    orderBy: { sentAt: "desc" },
  });
  if (!recipient) return;
  await prisma.$transaction([
    prisma.bulkCampaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "REPLIED", repliedAt: new Date() },
    }),
    prisma.bulkCampaign.update({
      where: { id: recipient.bulkCampaignId },
      data: { repliedCount: { increment: 1 } },
    }),
  ]);
}

async function markBulkRecipientFailed(messageId, error) {
  const recipient = await prisma.bulkCampaignRecipient.findFirst({
    where: { messageId, status: { in: ["QUEUED", "PENDING"] } },
  });
  if (!recipient) return;
  await prisma.$transaction([
    prisma.bulkCampaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "FAILED", failedAt: new Date(), error: error?.slice(0, 500) ?? "send failed" },
    }),
    prisma.bulkCampaign.update({
      where: { id: recipient.bulkCampaignId },
      data: { failedCount: { increment: 1 } },
    }),
  ]);
}

// ─── Read helpers (used by routes / dev tools) ────────────────────

export function listSessionsForChat(chatId) {
  return prisma.chatSession.findMany({
    where: { chatId },
    orderBy: { startedAt: "desc" },
    include: {
      campaign: { select: { id: true, name: true, tag: true } },
      _count: { select: { messages: true } },
    },
  });
}

export function listMessagesForSession(sessionId, limit = 100) {
  return prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}
