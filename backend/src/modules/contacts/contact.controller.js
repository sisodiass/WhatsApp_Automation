import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import {
  createContact,
  getContact,
  listContacts,
  listSources,
  renameSource,
  softDeleteContact,
  updateContact,
} from "./contact.service.js";
import {
  buildCsv,
  buildXlsx,
  importContacts,
  listContactsForExport,
  MAPPABLE_FIELDS,
} from "./contact.import.js";

// ─── Multer for CSV/XLSX uploads ─────────────────────────────────────
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

const importStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const id = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `contacts_${Date.now()}_${id}${ext}`);
  },
});

const ALLOWED_MIME = new Set([
  "text/csv",
  "application/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

export const importUploadMiddleware = multer({
  storage: importStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".csv", ".tsv", ".txt", ".xlsx", ".xls"].includes(ext)) {
      return cb(new Error("only CSV / TSV / XLSX uploads are allowed"));
    }
    // Some browsers send octet-stream for csv — fall back to extension check.
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error(`unsupported mime type: ${file.mimetype}`));
    }
    cb(null, true);
  },
}).single("file");

const baseContactSchema = z.object({
  firstName: z.string().max(120).nullable().optional(),
  lastName: z.string().max(120).nullable().optional(),
  mobile: z.string().min(5).max(40),
  email: z.string().email().max(200).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(120).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  source: z.string().max(80).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  customFields: z.record(z.any()).nullable().optional(),
});

export const list = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const result = await listContacts(tenantId, {
    search: req.query.search?.toString(),
    source: req.query.source?.toString(),
    ownerId: req.query.ownerId?.toString(),
    page: req.query.page,
    pageSize: req.query.pageSize,
    includeDeleted: req.query.includeDeleted === "true",
  });
  res.json(result);
});

export const getOne = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const c = await getContact(tenantId, req.params.id);
  res.json(c);
});

export const create = asyncHandler(async (req, res) => {
  const parsed = baseContactSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid contact payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const c = await createContact(tenantId, parsed.data);
  res.status(201).json(c);
});

export const patch = asyncHandler(async (req, res) => {
  const parsed = baseContactSchema.partial().safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid contact payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const c = await updateContact(tenantId, req.params.id, parsed.data);
  res.json(c);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  await softDeleteContact(tenantId, req.params.id);
  res.status(204).end();
});

// ─── Import ─────────────────────────────────────────────────────────

// mapping body is JSON in `req.body.mapping` (multer multipart text field).
// Format: { firstName: "First Name", mobile: "Phone", ... } — values are
// the CSV/XLSX header cells. Empty mapping triggers auto-detect by header
// name match (case + separator insensitive).
const importBodySchema = z.object({
  mapping: z
    .string()
    .optional()
    .transform((s) => {
      if (!s) return {};
      try {
        return JSON.parse(s);
      } catch {
        throw BadRequest("mapping must be valid JSON");
      }
    }),
  source: z.string().max(80).optional(),
});

export const fields = asyncHandler(async (req, res) => {
  // Used by the frontend mapping UI to show which fields are mappable.
  res.json({ fields: MAPPABLE_FIELDS });
});

export const importFile = asyncHandler(async (req, res) => {
  if (!req.file) throw BadRequest("file required");
  const parsed = importBodySchema.safeParse(req.body);
  if (!parsed.success) {
    fs.unlink(req.file.path, () => {});
    throw BadRequest("invalid import payload", parsed.error.flatten());
  }
  const tenantId = req.auth.tenantId;
  try {
    const result = await importContacts({
      tenantId,
      filePath: req.file.path,
      filename: req.file.originalname,
      mapping: parsed.data.mapping,
      source: parsed.data.source,
    });
    res.json(result);
  } finally {
    // Always clean up the uploaded file once parsing is done; we don't
    // need to keep it around (the rows are in the DB now).
    fs.unlink(req.file.path, () => {});
  }
});

// ─── Export ─────────────────────────────────────────────────────────

export const exportFile = asyncHandler(async (req, res) => {
  const format = (req.query.format || "csv").toString().toLowerCase();
  if (format !== "csv" && format !== "xlsx") {
    throw BadRequest("format must be csv or xlsx");
  }
  const tenantId = req.auth.tenantId;
  const rows = await listContactsForExport(tenantId, {
    source: req.query.source?.toString(),
    ownerId: req.query.ownerId?.toString(),
    includeDeleted: req.query.includeDeleted === "true",
  });

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    const csv = buildCsv(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="contacts_${stamp}.csv"`);
    return res.send(csv);
  }
  const buf = buildXlsx(rows);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="contacts_${stamp}.xlsx"`);
  res.send(buf);
});

// ─── Sources (master list + rename) ─────────────────────────────────

export const sources = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const items = await listSources(tenantId);
  res.json({ items });
});

const renameSchema = z.object({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
});

export const renameSourceCtrl = asyncHandler(async (req, res) => {
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const result = await renameSource(tenantId, parsed.data.from, parsed.data.to);
  res.json(result);
});
