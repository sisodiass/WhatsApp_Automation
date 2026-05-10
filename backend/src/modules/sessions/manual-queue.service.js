// Manual queue + mode-flip helpers. Used by the kb-search worker to handoff
// when the confidence gate fails or other auto-MANUAL triggers fire.

import { prisma } from "../../shared/prisma.js";
import { emitToAdmins } from "../../shared/socket.js";

export async function flipSessionToManual(sessionId, reason) {
  return prisma.chatSession.update({
    where: { id: sessionId },
    data: { mode: "MANUAL", state: "MANUAL" },
  });
}

export async function pushToManualQueue({ chatId, sessionId, reason }) {
  // Dedup: don't pile multiple unresolved items for the same session.
  const existing = await prisma.manualQueueItem.findFirst({
    where: { sessionId, resolvedAt: null },
  });
  if (existing) return existing;

  const item = await prisma.manualQueueItem.create({
    data: { chatId, sessionId, reason },
  });
  // Notify admin UI — Phase 7 will subscribe and surface in the manual queue.
  emitToAdmins("manual_queue:new", {
    id: item.id,
    chatId,
    sessionId,
    reason,
    createdAt: item.createdAt,
  });
  return item;
}
