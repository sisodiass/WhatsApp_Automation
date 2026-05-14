import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import {
  createPipeline,
  createStage,
  deletePipeline,
  deleteStage,
  getPipeline,
  listPipelines,
  reorderStages,
  updatePipeline,
  updateStage,
} from "./pipeline.service.js";

const pipelineSchema = z.object({
  name: z.string().min(1).max(120),
  isDefault: z.boolean().optional(),
});

const stageCategory = z.enum(["OPEN", "WON", "LOST"]);

const stageSchema = z.object({
  name: z.string().min(1).max(80),
  order: z.number().int().optional(),
  category: stageCategory.optional(),
  color: z.string().max(20).nullable().optional(),
});

const reorderSchema = z.object({
  updates: z.array(z.object({ id: z.string(), order: z.number().int() })).min(1),
});

export const listAll = asyncHandler(async (_req, res) => {
  const tenantId = await getDefaultTenantId();
  const items = await listPipelines(tenantId);
  res.json({ items });
});

export const getOne = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const p = await getPipeline(tenantId, req.params.id);
  res.json(p);
});

export const create = asyncHandler(async (req, res) => {
  const parsed = pipelineSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid pipeline payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const p = await createPipeline(tenantId, parsed.data);
  res.status(201).json(p);
});

export const patch = asyncHandler(async (req, res) => {
  const parsed = pipelineSchema.partial().safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid pipeline payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const p = await updatePipeline(tenantId, req.params.id, parsed.data);
  res.json(p);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  await deletePipeline(tenantId, req.params.id);
  res.status(204).end();
});

// ─── Stages ──────────────────────────────────────────────────────────

export const createStageRoute = asyncHandler(async (req, res) => {
  const parsed = stageSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid stage payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const s = await createStage(tenantId, req.params.pipelineId, parsed.data);
  res.status(201).json(s);
});

export const patchStageRoute = asyncHandler(async (req, res) => {
  const parsed = stageSchema.partial().safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid stage payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const s = await updateStage(tenantId, req.params.stageId, parsed.data);
  res.json(s);
});

export const reorderStagesRoute = asyncHandler(async (req, res) => {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid reorder payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  await reorderStages(tenantId, req.params.pipelineId, parsed.data.updates);
  res.status(204).end();
});

export const deleteStageRoute = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  await deleteStage(tenantId, req.params.stageId);
  res.status(204).end();
});
