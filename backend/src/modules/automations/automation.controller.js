import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import {
  createAutomation,
  deleteAutomation,
  fireForLead,
  getAutomation,
  listAutomations,
  listRecentRuns,
  updateAutomation,
} from "./automation.service.js";

const triggerEnum = z.enum([
  "NEW_LEAD",
  "STAGE_CHANGED",
  "LEAD_ASSIGNED",
  "NO_REPLY",
  "TAG_ADDED",
  "CAMPAIGN_REPLIED",
  "INBOUND_KEYWORD",
]);

const baseSchema = z.object({
  name: z.string().min(1).max(160),
  isActive: z.boolean().optional(),
  trigger: triggerEnum,
  triggerConfig: z.record(z.any()).nullable().optional(),
  // Definition arrives as JSON; service-side validateDefinition() does
  // shape checks. Zod just makes sure it's an object.
  definition: z.record(z.any()),
});

export const list = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const items = await listAutomations(tenantId);
  res.json({ items });
});

export const getOne = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const a = await getAutomation(tenantId, req.params.id);
  res.json(a);
});

export const create = asyncHandler(async (req, res) => {
  const parsed = baseSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid automation payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const a = await createAutomation(tenantId, parsed.data, req.user?.id);
  res.status(201).json(a);
});

export const patch = asyncHandler(async (req, res) => {
  const parsed = baseSchema.partial().safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid automation payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const a = await updateAutomation(tenantId, req.params.id, parsed.data);
  res.json(a);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  await deleteAutomation(tenantId, req.params.id);
  res.status(204).end();
});

export const runs = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const items = await listRecentRuns(tenantId, {
    automationId: req.query.automationId?.toString(),
    leadId: req.query.leadId?.toString(),
    status: req.query.status?.toString(),
    limit: req.query.limit,
  });
  res.json({ items });
});

export const fire = asyncHandler(async (req, res) => {
  const parsed = z.object({ leadId: z.string() }).safeParse(req.body);
  if (!parsed.success) throw BadRequest("leadId required", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const run = await fireForLead(tenantId, req.params.id, parsed.data.leadId);
  res.status(201).json(run);
});
