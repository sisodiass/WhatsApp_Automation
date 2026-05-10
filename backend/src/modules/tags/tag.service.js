import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";

export function listTags(tenantId) {
  return prisma.tag.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
    include: { _count: { select: { chats: true } } },
  });
}

export async function createTag(tenantId, { name, color }) {
  if (!name || !name.trim()) throw BadRequest("name required");
  return prisma.tag
    .create({ data: { tenantId, name: name.trim(), color: color || null } })
    .catch((err) => {
      if (err.code === "P2002") throw BadRequest("tag with this name already exists");
      throw err;
    });
}

export async function updateTag(tenantId, id, { name, color }) {
  const t = await prisma.tag.findUnique({ where: { id } });
  if (!t || t.tenantId !== tenantId) throw NotFound("tag not found");
  return prisma.tag.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(color !== undefined ? { color: color || null } : {}),
    },
  });
}

export async function deleteTag(tenantId, id) {
  const t = await prisma.tag.findUnique({ where: { id } });
  if (!t || t.tenantId !== tenantId) throw NotFound("tag not found");
  await prisma.tag.delete({ where: { id } });
  return { ok: true };
}

// ─── Chat ↔ Tag assignment ───────────────────────────────────────────

export async function assignTag(tenantId, chatId, tagId) {
  const [chat, tag] = await Promise.all([
    prisma.chat.findUnique({ where: { id: chatId } }),
    prisma.tag.findUnique({ where: { id: tagId } }),
  ]);
  if (!chat || chat.tenantId !== tenantId) throw NotFound("chat not found");
  if (!tag || tag.tenantId !== tenantId) throw NotFound("tag not found");

  await prisma.chatTag.upsert({
    where: { chatId_tagId: { chatId, tagId } },
    update: {},
    create: { chatId, tagId },
  });
  return { ok: true };
}

export async function unassignTag(tenantId, chatId, tagId) {
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat || chat.tenantId !== tenantId) throw NotFound("chat not found");
  await prisma.chatTag.deleteMany({ where: { chatId, tagId } });
  return { ok: true };
}
