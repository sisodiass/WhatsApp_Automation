import { z } from "zod";
import { asyncHandler, BadRequest, Forbidden } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import {
  addLeadNote,
  createLead,
  deleteLead,
  getBoard,
  getLead,
  listLeads,
  moveLeadStage,
  updateLead,
} from "./lead.service.js";

// AGENT can only see + write leads assigned to them. Higher roles are
// unrestricted. Returns an assignedToId filter override (or null = no
// override). Use in every endpoint that returns or mutates a lead.
function agentScopeFilter(user) {
  if (!user) return null;
  return user.role === "AGENT" ? user.id : null;
}

async function ensureAgentCanAccessLead(user, leadId) {
  const enforce = agentScopeFilter(user);
  if (!enforce) return;
  // tenantId is enforced in getLead; here we additionally check assignment.
  const lead = await getLead(user.tenantId, leadId).catch(() => null);
  if (!lead || lead.assignedToId !== user.id) throw Forbidden("not assigned");
}

const leadScore = z.enum(["HOT", "WARM", "COLD", "UNQUALIFIED"]);

const createSchema = z.object({
  contactId: z.string(),
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  source: z.string().max(80).nullable().optional(),
  campaignId: z.string().nullable().optional(),
  assignedToId: z.string().nullable().optional(),
  expectedValue: z.number().nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
});

const updateSchema = z.object({
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  source: z.string().max(80).nullable().optional(),
  campaignId: z.string().nullable().optional(),
  assignedToId: z.string().nullable().optional(),
  score: leadScore.nullable().optional(),
  aiScore: z.number().nullable().optional(),
  expectedValue: z.number().nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  lostReason: z.string().max(500).nullable().optional(),
});

export const list = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const scope = agentScopeFilter(req.user);
  const result = await listLeads(tenantId, {
    search: req.query.search?.toString(),
    pipelineId: req.query.pipelineId?.toString(),
    stageId: req.query.stageId?.toString(),
    assignedToId: scope ?? req.query.assignedToId?.toString(),
    contactId: req.query.contactId?.toString(),
    score: req.query.score?.toString(),
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json(result);
});

export const board = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const scope = agentScopeFilter(req.user);
  const data = await getBoard(tenantId, req.params.pipelineId, {
    assignedToId: scope ?? req.query.assignedToId?.toString(),
    score: req.query.score?.toString(),
  });
  res.json(data);
});

export const getOne = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const l = await getLead(tenantId, req.params.id);
  // AGENT may only see leads assigned to them.
  if (agentScopeFilter(req.user) && l.assignedToId !== req.user.id) {
    throw Forbidden("not assigned");
  }
  res.json(l);
});

export const create = asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid lead payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const l = await createLead(tenantId, parsed.data, req.user?.id);
  res.status(201).json(l);
});

export const patch = asyncHandler(async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid lead payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  await ensureAgentCanAccessLead(req.user, req.params.id);
  const l = await updateLead(tenantId, req.params.id, parsed.data, req.user?.id);
  res.json(l);
});

export const moveStage = asyncHandler(async (req, res) => {
  const parsed = z.object({ stageId: z.string() }).safeParse(req.body);
  if (!parsed.success) throw BadRequest("stageId required", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  await ensureAgentCanAccessLead(req.user, req.params.id);
  const l = await moveLeadStage(tenantId, req.params.id, parsed.data.stageId, req.user?.id);
  res.json(l);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  await deleteLead(tenantId, req.params.id);
  res.status(204).end();
});

export const addNote = asyncHandler(async (req, res) => {
  const parsed = z.object({ body: z.string().min(1).max(5000) }).safeParse(req.body);
  if (!parsed.success) throw BadRequest("body required", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  await ensureAgentCanAccessLead(req.user, req.params.id);
  const n = await addLeadNote(tenantId, req.params.id, parsed.data.body, req.user?.id);
  res.status(201).json(n);
});
