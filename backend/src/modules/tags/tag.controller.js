import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import {
  assignTag,
  createTag,
  deleteTag,
  listTags,
  unassignTag,
  updateTag,
} from "./tag.service.js";

const tagSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().max(20).nullable().optional(),
});

export const list = asyncHandler(async (_req, res) => {
  const tenantId = await getDefaultTenantId();
  const items = await listTags(tenantId);
  res.json({ items });
});

export const create = asyncHandler(async (req, res) => {
  const parsed = tagSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid tag payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const tag = await createTag(tenantId, parsed.data);
  res.status(201).json(tag);
});

export const patch = asyncHandler(async (req, res) => {
  const parsed = tagSchema.partial().safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid tag payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const tag = await updateTag(tenantId, req.params.id, parsed.data);
  res.json(tag);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  await deleteTag(tenantId, req.params.id);
  res.status(204).end();
});

export const assign = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  await assignTag(tenantId, req.params.chatId, req.params.tagId);
  res.status(204).end();
});

export const unassign = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  await unassignTag(tenantId, req.params.chatId, req.params.tagId);
  res.status(204).end();
});
