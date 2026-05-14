// In-app notifications. Per-user, polled from the bell icon in AppShell
// (NOT Socket.io — per the project memory rule that socket scope stays
// narrow to chat + QR).
//
// Producers call createNotification(...) directly OR subscribe to domain
// events via the M8 subscriber. Consumers (the bell UI) pull recent rows
// and mark-read on click.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { NotFound } from "../../shared/errors.js";

const log = child("notifications");

export async function createNotification(data) {
  if (!data.tenantId || !data.userId || !data.kind || !data.title) {
    log.warn("notification skipped — missing required fields", {
      tenantId: data.tenantId,
      userId: data.userId,
      kind: data.kind,
    });
    return null;
  }
  return prisma.notification.create({
    data: {
      tenantId: data.tenantId,
      userId: data.userId,
      kind: data.kind,
      title: data.title,
      body: data.body ?? null,
      leadId: data.leadId ?? null,
      chatId: data.chatId ?? null,
      url: data.url ?? null,
    },
  });
}

export function listNotifications(userId, opts = {}) {
  const { limit = 30, unreadOnly = false } = opts;
  return prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 30, 1), 200),
  });
}

export async function countUnread(userId) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId, id) {
  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) throw NotFound("notification not found");
  if (existing.readAt) return existing;
  return prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId) {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}
