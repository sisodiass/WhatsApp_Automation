import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { z } from "zod";

import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import {
  createDocumentVersion,
  createKbGroup,
  deleteDocument,
  deleteKbGroup,
  getDocument,
  getKbGroup,
  listDocuments,
  listKbGroups,
  updateKbGroup,
} from "./kb.service.js";
import { enqueuePdfProcessing } from "./kb.queue.js";

// ─── Multer: PDF uploads to backend/uploads/ ─────────────────────────

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const id = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(file.originalname).toLowerCase() || ".pdf";
    cb(null, `${Date.now()}_${id}${ext}`);
  },
});

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("only PDF uploads are allowed"));
    }
    cb(null, true);
  },
}).single("file");

// ─── Groups ──────────────────────────────────────────────────────────

const groupSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
});

export const listGroups = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const items = await listKbGroups(tenantId);
  res.json({ items });
});

export const createGroup = asyncHandler(async (req, res) => {
  const parsed = groupSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid kb group payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const group = await createKbGroup(tenantId, parsed.data);
  res.status(201).json(group);
});

export const getGroup = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const group = await getKbGroup(tenantId, req.params.id);
  res.json(group);
});

export const patchGroup = asyncHandler(async (req, res) => {
  const parsed = groupSchema.partial().safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid kb group payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const group = await updateKbGroup(tenantId, req.params.id, parsed.data);
  res.json(group);
});

export const deleteGroup = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  await deleteKbGroup(tenantId, req.params.id);
  res.status(204).end();
});

// ─── Documents ───────────────────────────────────────────────────────

export const listDocs = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  await getKbGroup(tenantId, req.params.id); // 404 guard
  const items = await listDocuments(tenantId, req.params.id);
  res.json({ items });
});

// POST /api/kb/groups/:id/documents — multipart, field "file"
export const uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw BadRequest("missing file");
  const tenantId = req.auth.tenantId;

  const doc = await createDocumentVersion({
    tenantId,
    kbGroupId: req.params.id,
    filename: req.file.originalname,
    filePath: req.file.path,
    uploadedById: req.auth?.userId,
  });

  // Hand off to the worker. 202 Accepted; the UI polls `status` for progress.
  await enqueuePdfProcessing(doc.id);

  res.status(202).json(doc);
});

export const removeDocument = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  await getDocument(tenantId, req.params.docId); // 404 guard scoped to tenant
  await deleteDocument(tenantId, req.params.docId);
  res.status(204).end();
});

// Re-process (e.g. after fixing OPENAI_API_KEY).
export const reprocessDocument = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const doc = await getDocument(tenantId, req.params.docId);
  await enqueuePdfProcessing(doc.id);
  res.json({ ok: true });
});

// Bulk re-embed: enqueue every active document for the given group (or all
// groups if no id) under the active AI provider. Use after switching
// providers OR upgrading the embedding model. Returns the count enqueued.
export const reembedAll = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const groupId = req.params.id || null;

  const where = { isActive: true, kbGroup: { tenantId } };
  if (groupId) where.kbGroupId = groupId;

  const docs = await prisma.kbDocument.findMany({
    where,
    select: { id: true },
  });

  for (const d of docs) {
    await enqueuePdfProcessing(d.id);
  }

  res.status(202).json({ enqueued: docs.length, scope: groupId ? "group" : "all" });
});
