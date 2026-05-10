import { prisma } from "../../shared/prisma.js";
import { BadRequest, Forbidden, NotFound } from "../../shared/errors.js";

export async function listNotes(tenantId, chatId) {
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat || chat.tenantId !== tenantId) throw NotFound("chat not found");
  return prisma.note.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    include: { author: { select: { id: true, email: true, name: true } } },
  });
}

export async function createNote({ tenantId, chatId, body, authorId }) {
  if (!body || !body.trim()) throw BadRequest("body required");
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat || chat.tenantId !== tenantId) throw NotFound("chat not found");
  return prisma.note.create({
    data: { chatId, authorId: authorId || null, body: body.trim() },
    include: { author: { select: { id: true, email: true, name: true } } },
  });
}

export async function deleteNote({ tenantId, noteId, userId, role }) {
  const n = await prisma.note.findUnique({
    where: { id: noteId },
    include: { chat: true },
  });
  if (!n || n.chat.tenantId !== tenantId) throw NotFound("note not found");
  // AGENT can only delete their own notes; ADMIN+ can delete any.
  if (role === "AGENT" && n.authorId !== userId) {
    throw Forbidden("agents can only delete their own notes");
  }
  await prisma.note.delete({ where: { id: noteId } });
  return { ok: true };
}
