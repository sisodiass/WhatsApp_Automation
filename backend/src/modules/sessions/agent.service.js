// Agent-facing operations: send a manual reply, flip mode/state, claim
// and resolve manual-queue items. Calling sendAgentReply on an AI session
// transitions it to MANUAL automatically (this is the user's "manual
// override priority" rule — A2).

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { BadRequest, NotFound } from "../../shared/errors.js";
import { emitChatMessage, emitSessionUpdate } from "../../shared/socket.js";
import { enqueueOutbound } from "../queue/producers.js";
import { assertQuota } from "../billing/quota.service.js";

const log = child("agent");

// ─── Manual reply ────────────────────────────────────────────────────

export async function sendAgentReply({ tenantId, chatId, body, authorId }) {
  if (!body || !body.trim()) throw BadRequest("body required");

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      sessions: {
        where: { endedAt: null },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!chat || chat.tenantId !== tenantId) throw NotFound("chat not found");

  const session = chat.sessions[0];
  if (!session) throw BadRequest("chat has no active session");

  // M11.C3c: plan quota gate. Throws 402 QuotaExceeded with a
  // structured details payload when the tenant has hit
  // messages_per_month. Checked before the message+session writes so
  // an over-quota agent reply doesn't leave a dangling OUT row.
  await assertQuota(tenantId, "messages_per_month");

  // A2: an agent reply implicitly takes ownership. Flip mode if needed
  // so any in-flight AI outbound aborts at the outgoing-worker gate.
  const updates = {};
  if (session.mode !== "MANUAL") updates.mode = "MANUAL";
  if (session.state === "NEW" || session.state === "ACTIVE") updates.state = "MANUAL";

  const msg = await prisma.$transaction(async (tx) => {
    if (Object.keys(updates).length) {
      await tx.chatSession.update({ where: { id: session.id }, data: updates });
    }
    return tx.message.create({
      data: {
        sessionId: session.id,
        direction: "OUT",
        source: "AGENT",
        body: body.trim(),
        kbChunkIds: [],
      },
    });
  });

  // Notify open chat panels immediately; sentAt populates after wa-worker
  // delivers it and emits OUTBOUND_ACK.
  emitChatMessage({ ...msg, chatId });
  if (Object.keys(updates).length) {
    emitSessionUpdate(session.id, { mode: "MANUAL", state: updates.state || session.state });
  }

  // Agent messages skip the typing simulation — the customer is talking
  // to a human now and expects a normal cadence.
  await enqueueOutbound(msg.id, { delayMs: 0 });

  log.info("agent reply sent", {
    chatId,
    sessionId: session.id,
    messageId: msg.id,
    flippedMode: !!updates.mode,
    authorId,
  });

  return { message: msg, sessionId: session.id };
}

// ─── Mode / State controls ───────────────────────────────────────────

export async function setSessionMode(tenantId, sessionId, mode) {
  if (mode !== "AI" && mode !== "MANUAL") throw BadRequest("mode must be AI | MANUAL");
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: { chat: true },
  });
  if (!session || session.chat.tenantId !== tenantId) throw NotFound("session not found");
  if (session.endedAt) throw BadRequest("session is closed");

  const data = { mode };
  // Resetting to AI from MANUAL also resets state if it was MANUAL.
  if (mode === "AI" && session.state === "MANUAL") data.state = "ACTIVE";
  if (mode === "MANUAL" && (session.state === "NEW" || session.state === "ACTIVE")) {
    data.state = "MANUAL";
  }

  const updated = await prisma.chatSession.update({ where: { id: sessionId }, data });
  emitSessionUpdate(sessionId, { mode: updated.mode, state: updated.state });
  return updated;
}

const ALLOWED_AGENT_STATES = new Set(["ACTIVE", "PAUSED", "FOLLOWUP", "CLOSED"]);

export async function setSessionState(tenantId, sessionId, state) {
  if (!ALLOWED_AGENT_STATES.has(state)) {
    throw BadRequest(`state must be one of ${[...ALLOWED_AGENT_STATES].join(", ")}`);
  }
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: { chat: true },
  });
  if (!session || session.chat.tenantId !== tenantId) throw NotFound("session not found");

  const data = { state };
  if (state === "CLOSED") {
    data.endedAt = new Date();
    data.endedReason = "ADMIN_CLOSED";
  }
  const updated = await prisma.chatSession.update({ where: { id: sessionId }, data });
  emitSessionUpdate(sessionId, { state: updated.state, endedAt: updated.endedAt });
  return updated;
}

// ─── Manual queue ────────────────────────────────────────────────────

export async function listManualQueue(tenantId) {
  const items = await prisma.manualQueueItem.findMany({
    where: {
      resolvedAt: null,
      chat: { tenantId },
    },
    orderBy: { createdAt: "asc" },
    include: {
      chat: { select: { id: true, phone: true, displayName: true } },
      session: { select: { id: true, mode: true, state: true, aiReplyCount: true } },
      claimedBy: { select: { id: true, email: true, name: true } },
    },
  });
  return items;
}

export async function claimManualQueueItem(tenantId, itemId, userId) {
  const item = await prisma.manualQueueItem.findUnique({
    where: { id: itemId },
    include: { chat: true },
  });
  if (!item || item.chat.tenantId !== tenantId) throw NotFound("queue item not found");
  if (item.resolvedAt) throw BadRequest("item already resolved");
  if (item.claimedById && item.claimedById !== userId) {
    throw BadRequest("item claimed by another agent");
  }
  const updated = await prisma.manualQueueItem.update({
    where: { id: itemId },
    data: { claimedById: userId, claimedAt: new Date() },
  });
  return updated;
}

export async function releaseManualQueueItem(tenantId, itemId, userId) {
  const item = await prisma.manualQueueItem.findUnique({
    where: { id: itemId },
    include: { chat: true },
  });
  if (!item || item.chat.tenantId !== tenantId) throw NotFound("queue item not found");
  if (item.claimedById !== userId) throw BadRequest("not your item");
  return prisma.manualQueueItem.update({
    where: { id: itemId },
    data: { claimedById: null, claimedAt: null },
  });
}

export async function resolveManualQueueItem(tenantId, itemId) {
  const item = await prisma.manualQueueItem.findUnique({
    where: { id: itemId },
    include: { chat: true },
  });
  if (!item || item.chat.tenantId !== tenantId) throw NotFound("queue item not found");
  if (item.resolvedAt) return item;
  return prisma.manualQueueItem.update({
    where: { id: itemId },
    data: { resolvedAt: new Date() },
  });
}
