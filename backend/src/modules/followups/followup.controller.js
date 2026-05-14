import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import {
  createRule,
  deleteRule,
  getRule,
  listRecentLogs,
  listRules,
  updateRule,
} from "./followup.service.js";

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");

const ruleSchema = z.object({
  name: z.string().min(1).max(160),
  isActive: z.boolean().optional(),
  pipelineId: z.string().nullable().optional(),
  stageId: z.string().nullable().optional(),
  hoursSinceLastInbound: z.number().int().min(1).max(8760),
  templateName: z.string().min(1).max(80),
  maxReminders: z.number().int().min(1).max(20).optional(),
  quietHoursStart: HHMM.nullable().optional(),
  quietHoursEnd: HHMM.nullable().optional(),
});

export const list = asyncHandler(async (_req, res) => {
  const tenantId = await getDefaultTenantId();
  const items = await listRules(tenantId);
  res.json({ items });
});

export const getOne = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const rule = await getRule(tenantId, req.params.id);
  res.json(rule);
});

export const create = asyncHandler(async (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid rule payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const rule = await createRule(tenantId, parsed.data, req.user?.id);
  res.status(201).json(rule);
});

export const patch = asyncHandler(async (req, res) => {
  const parsed = ruleSchema.partial().safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid rule payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const rule = await updateRule(tenantId, req.params.id, parsed.data);
  res.json(rule);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  await deleteRule(tenantId, req.params.id);
  res.status(204).end();
});

export const logs = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const items = await listRecentLogs(tenantId, {
    ruleId: req.query.ruleId?.toString(),
    leadId: req.query.leadId?.toString(),
    limit: req.query.limit,
  });
  res.json({ items });
});
