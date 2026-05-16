import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import {
  addRecipientsByContactIds,
  approveAndSchedule,
  cancelBulkCampaign,
  createBulkCampaign,
  deleteBulkCampaign,
  getBulkAnalytics,
  getBulkCampaign,
  listBulkCampaigns,
  listRecipients,
  pauseBulkCampaign,
  removeRecipient,
  resolveAudienceFilter,
  resumeBulkCampaign,
  submitForApproval,
  updateBulkCampaign,
} from "./bulk-campaign.service.js";

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");

const safetySchema = {
  dailyLimit: z.number().int().min(1).max(100000).optional(),
  delayMin: z.number().int().min(0).max(3600).optional(),
  delayMax: z.number().int().min(0).max(3600).optional(),
  quietHoursStart: HHMM.nullable().optional(),
  quietHoursEnd: HHMM.nullable().optional(),
  skipRepliedHours: z.number().int().min(0).max(8760).optional(),
};

const createSchema = z.object({
  name: z.string().min(1).max(160),
  messageBody: z.string().min(1).max(4096),
  mediaUrl: z.string().url().nullable().optional(),
  mediaType: z.string().max(40).nullable().optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  ...safetySchema,
});

const updateSchema = createSchema.partial();

const audienceSchema = z.object({
  contactIds: z.array(z.string()).min(1).max(10000),
});

const audienceFilterSchema = z.object({
  search: z.string().optional(),
  source: z.string().optional(),
  limit: z.number().int().min(1).max(10000).optional(),
});

const approveSchema = z.object({
  scheduledAt: z.coerce.date().nullable().optional(),
});

export const list = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const result = await listBulkCampaigns(tenantId, {
    status: req.query.status?.toString(),
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json(result);
});

export const getOne = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const c = await getBulkCampaign(tenantId, req.params.id);
  res.json(c);
});

export const create = asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid bulk payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const c = await createBulkCampaign(tenantId, parsed.data, req.user?.id);
  res.status(201).json(c);
});

export const patch = asyncHandler(async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid bulk payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const c = await updateBulkCampaign(tenantId, req.params.id, parsed.data);
  res.json(c);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  await deleteBulkCampaign(tenantId, req.params.id);
  res.status(204).end();
});

// ─── Audience ───────────────────────────────────────────────────────

export const addRecipients = asyncHandler(async (req, res) => {
  const parsed = audienceSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("contactIds required", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const result = await addRecipientsByContactIds(tenantId, req.params.id, parsed.data.contactIds);
  res.json(result);
});

export const previewAudience = asyncHandler(async (req, res) => {
  const parsed = audienceFilterSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid filter", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const ids = await resolveAudienceFilter(tenantId, parsed.data);
  res.json({ contactIds: ids, count: ids.length });
});

export const recipients = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const result = await listRecipients(tenantId, req.params.id, {
    status: req.query.status?.toString(),
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json(result);
});

export const deleteRecipient = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  await removeRecipient(tenantId, req.params.id, req.params.recipientId);
  res.status(204).end();
});

// ─── Lifecycle ──────────────────────────────────────────────────────

export const submit = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const c = await submitForApproval(tenantId, req.params.id);
  res.json(c);
});

export const approve = asyncHandler(async (req, res) => {
  const parsed = approveSchema.safeParse(req.body || {});
  if (!parsed.success) throw BadRequest("invalid approval payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const c = await approveAndSchedule(
    tenantId,
    req.params.id,
    req.user?.id,
    parsed.data.scheduledAt ?? null,
  );
  res.json(c);
});

export const pause = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const c = await pauseBulkCampaign(tenantId, req.params.id);
  res.json(c);
});

export const resume = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const c = await resumeBulkCampaign(tenantId, req.params.id);
  res.json(c);
});

export const cancel = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const c = await cancelBulkCampaign(tenantId, req.params.id);
  res.json(c);
});

// ─── Analytics ──────────────────────────────────────────────────────

export const analytics = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const data = await getBulkAnalytics(tenantId, req.params.id);
  res.json(data);
});
