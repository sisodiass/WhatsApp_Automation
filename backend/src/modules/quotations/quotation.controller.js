import fs from "node:fs";
import { z } from "zod";
import { asyncHandler, BadRequest, NotFound } from "../../shared/errors.js";
import {
  acceptQuotation,
  createQuotation,
  decideApproval,
  draftFromAiSuggestion,
  getQuotation,
  listQuotations,
  rejectQuotation,
  requestApproval,
  reviseQuotation,
  sendQuotation,
  softDeleteQuotation,
  updateQuotation,
} from "./quotation.service.js";
import {
  getQuotationPdfPath,
  renderQuotationPdf,
} from "./quotation.pdf.service.js";

const lineItemSchema = z.object({
  productId: z.string().nullable().optional(),
  description: z.string().min(1).max(500),
  qty: z.union([z.number(), z.string()]),
  unitPrice: z.union([z.number(), z.string()]),
  discountPct: z.union([z.number(), z.string()]).optional(),
  taxRatePct: z.union([z.number(), z.string()]).optional(),
});

const createSchema = z.object({
  contactId: z.string().min(1),
  leadId: z.string().nullable().optional(),
  currency: z.string().length(3).optional(),
  validUntil: z.string().datetime().optional(),
  terms: z.string().max(4000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  draftedByAi: z.boolean().optional(),
  lineItems: z.array(lineItemSchema).min(1),
});

const updateSchema = z.object({
  currency: z.string().length(3).optional(),
  validUntil: z.string().datetime().optional(),
  terms: z.string().max(4000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  lineItems: z.array(lineItemSchema).optional(),
});

export const list = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const result = await listQuotations(tenantId, {
    search: req.query.search?.toString(),
    status: req.query.status?.toString(),
    leadId: req.query.leadId?.toString(),
    contactId: req.query.contactId?.toString(),
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json(result);
});

export const getOne = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.json(await getQuotation(tenantId, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid quotation payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  res.status(201).json(await createQuotation(tenantId, parsed.data, req.user?.id));
});

export const patch = asyncHandler(async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid quotation payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  res.json(await updateQuotation(tenantId, req.params.id, parsed.data));
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  await softDeleteQuotation(tenantId, req.params.id);
  res.status(204).end();
});

export const send = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.json(await sendQuotation(tenantId, req.params.id, req.user?.id));
});

export const accept = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.json(await acceptQuotation(tenantId, req.params.id, req.user?.id));
});

export const reject = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.json(await rejectQuotation(tenantId, req.params.id));
});

export const revise = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.status(201).json(await reviseQuotation(tenantId, req.params.id, req.user?.id));
});

const approvalSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().max(500).nullable().optional(),
});

export const requestApprovalCtrl = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.status(201).json(await requestApproval(tenantId, req.params.id, req.user?.id));
});

export const decideApprovalCtrl = asyncHandler(async (req, res) => {
  const parsed = approvalSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid approval payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  res.json(
    await decideApproval(
      tenantId,
      req.params.approvalId,
      parsed.data.decision,
      req.user?.id,
      parsed.data.comment,
    ),
  );
});

export const pdfCtrl = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  // Make sure the quote exists for this tenant.
  await getQuotation(tenantId, req.params.id);
  let pdfPath = getQuotationPdfPath(tenantId, req.params.id);
  if (!pdfPath) {
    // Render on demand; ignore failures so we don't 500 here (we'll return 404).
    try {
      pdfPath = await renderQuotationPdf(tenantId, req.params.id);
    } catch {
      throw NotFound("pdf not available");
    }
  }
  const isText = pdfPath.endsWith(".txt");
  res.setHeader(
    "Content-Type",
    isText ? "text/plain; charset=utf-8" : "application/pdf",
  );
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${req.params.id}${isText ? ".txt" : ".pdf"}"`,
  );
  fs.createReadStream(pdfPath).pipe(res);
});

const aiDraftSchema = z.object({
  leadId: z.string().min(1),
  items: z.array(lineItemSchema).min(1),
  terms: z.string().max(4000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

// Internal endpoint exercised by the AI sales agent layer. Same shape as
// create() but stamps draftedByAi=true and enqueues a manual review.
export const aiDraft = asyncHandler(async (req, res) => {
  const parsed = aiDraftSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid AI-draft payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  res.status(201).json(await draftFromAiSuggestion(tenantId, parsed.data));
});
