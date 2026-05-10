import { asyncHandler, BadRequest, NotFound } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import { config } from "../../config/index.js";
import { listMessagesForSession, listSessionsForChat } from "./session.service.js";

export const listChats = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
  const { q, state, mode, tag } = req.query;

  // Build a single sessions.some clause so all session-level filters resolve
  // against the SAME session (otherwise Prisma allows different sessions to
  // satisfy each individual filter — wrong semantics).
  //
  // Inbox is hard-filtered to chats that have at least one campaign-initiated
  // session. Customers who messaged without a valid campaign tag never had a
  // session created for them, so they're naturally excluded — but if any
  // chat row exists with non-campaign sessions (legacy / edge cases), this
  // filter keeps them out of the inbox view.
  const sessionsSome = { campaignId: { not: null } };
  if (state) {
    sessionsSome.state = state;
    sessionsSome.endedAt = null;
  }
  if (mode) {
    sessionsSome.mode = mode;
    sessionsSome.endedAt = null;
  }

  const where = {
    tenantId,
    sessions: { some: sessionsSome },
  };
  if (q && q.trim()) {
    where.OR = [
      { phone: { contains: q.trim() } },
      { displayName: { contains: q.trim(), mode: "insensitive" } },
    ];
  }
  if (tag) where.tags = { some: { tagId: tag } };

  const items = await prisma.chat.findMany({
    where,
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: limit,
    include: {
      sessions: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: {
          id: true,
          state: true,
          mode: true,
          aiReplyCount: true,
          startedAt: true,
          lastActivityAt: true,
          endedAt: true,
        },
      },
      tags: { include: { tag: true } },
      _count: {
        select: {
          manualQueueItems: { where: { resolvedAt: null } },
        },
      },
    },
  });
  res.json({ items });
});

export const listSessions = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const chat = await prisma.chat.findUnique({
    where: { id: req.params.chatId },
    include: { tags: { include: { tag: true } } },
  });
  if (!chat || chat.tenantId !== tenantId) throw NotFound("chat not found");
  const items = await listSessionsForChat(chat.id);
  res.json({ chat, items });
});

export const getMessages = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const session = await prisma.chatSession.findUnique({
    where: { id: req.params.sessionId },
    include: { chat: true },
  });
  if (!session || session.chat.tenantId !== tenantId) throw NotFound("session not found");
  const items = await listMessagesForSession(session.id);
  res.json({ session, items });
});

// Dev-only: backdate `last_activity_at` so the operator can verify the
// 24h-resume and 7d-reset rules without literally waiting. Disabled in prod.
export const devBackdate = asyncHandler(async (req, res) => {
  if (config.env === "production") throw NotFound();
  const { sessionId, hoursAgo } = req.body || {};
  const hours = Number(hoursAgo);
  if (!sessionId || !Number.isFinite(hours) || hours < 0)
    throw BadRequest("body: { sessionId, hoursAgo }");
  const at = new Date(Date.now() - hours * 60 * 60 * 1000);
  const updated = await prisma.chatSession.update({
    where: { id: sessionId },
    data: { lastActivityAt: at },
  });
  res.json({ ok: true, sessionId: updated.id, lastActivityAt: updated.lastActivityAt });
});
