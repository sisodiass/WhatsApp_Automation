import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { createNote, deleteNote, listNotes } from "./note.service.js";

const noteSchema = z.object({ body: z.string().min(1).max(4000) });

export const list = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const items = await listNotes(tenantId, req.params.chatId);
  res.json({ items });
});

export const create = asyncHandler(async (req, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid note payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const note = await createNote({
    tenantId,
    chatId: req.params.chatId,
    body: parsed.data.body,
    authorId: req.auth.userId,
  });
  res.status(201).json(note);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  await deleteNote({
    tenantId,
    noteId: req.params.id,
    userId: req.auth.userId,
    role: req.auth.role,
  });
  res.status(204).end();
});
