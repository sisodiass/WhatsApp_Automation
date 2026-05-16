import { asyncHandler, BadRequest, NotFound } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { config } from "../../config/index.js";
import { listMessagesForSession, listSessionsForChat } from "./session.service.js";

export const listChats = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
  const { q, state, mode, tag, campaignId } = req.query;

  // Build a single sessions.some clause so all session-level filters resolve
  // against the SAME session (otherwise Prisma allows different sessions to
  // satisfy each individual filter — wrong semantics).
  //
  // Originally we hard-filtered to campaign-initiated sessions. M9 added
  // web-chat sessions which have no campaignId by design — so we now show
  // a chat when EITHER (a) it has a campaign session, OR (b) it's on a
  // non-WhatsApp channel (web-chat / Instagram / FB). Explicit campaignId
  // filter still applies if the operator selected one.
  const sessionsSome = {};
  if (state) {
    sessionsSome.state = state;
    sessionsSome.endedAt = null;
  }
  if (mode) {
    sessionsSome.mode = mode;
    sessionsSome.endedAt = null;
  }
  if (campaignId) sessionsSome.campaignId = campaignId;

  const where = {
    tenantId,
    OR: campaignId
      ? [{ sessions: { some: sessionsSome } }]
      : [
          { sessions: { some: { ...sessionsSome, campaignId: { not: null } } } },
          // Non-WhatsApp chats are first-class even without a campaign tag.
          { channel: { type: { not: "WHATSAPP" } }, sessions: { some: sessionsSome } },
        ],
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
          campaign: { select: { id: true, name: true, tag: true } },
        },
      },
      // M9: surface the originating channel for the Inbox badge.
      channel: { select: { id: true, type: true, name: true } },
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
  const tenantId = req.auth.tenantId;
  const chat = await prisma.chat.findUnique({
    where: { id: req.params.chatId },
    include: { tags: { include: { tag: true } } },
  });
  if (!chat || chat.tenantId !== tenantId) throw NotFound("chat not found");
  const items = await listSessionsForChat(chat.id);
  res.json({ chat, items });
});

export const getMessages = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
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
