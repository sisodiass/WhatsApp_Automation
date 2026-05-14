import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import {
  createIntegration,
  deleteIntegration,
  getIntegration,
  invalidateCache,
  listIntegrations,
  regenerateApiKey,
  updateIntegration,
} from "./integration.service.js";

const baseSchema = z.object({
  name: z.string().min(1).max(160),
  allowedDomains: z.array(z.string().min(1).max(253)).max(50).optional(),
  isActive: z.boolean().optional(),
  widgetEnabled: z.boolean().optional(),
  rateLimitPerMinute: z.number().int().min(1).max(10000).optional(),
  widgetConfig: z.record(z.any()).nullable().optional(),
});

export const list = asyncHandler(async (_req, res) => {
  const tenantId = await getDefaultTenantId();
  const items = await listIntegrations(tenantId);
  res.json({ items });
});

// Single-fetch returns the FULL key. Used by the admin edit form so the
// operator can copy-paste it. no-store so it doesn't sit in proxies.
export const getOne = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const row = await getIntegration(tenantId, req.params.id);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(row);
});

export const create = asyncHandler(async (req, res) => {
  const parsed = baseSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const row = await createIntegration(tenantId, parsed.data, req.user?.id);
  res.status(201).json(row);
});

export const patch = asyncHandler(async (req, res) => {
  const parsed = baseSchema.partial().safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const row = await updateIntegration(tenantId, req.params.id, parsed.data);
  invalidateCache(row.apiKey);
  res.json(row);
});

export const rotate = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  // Look up the existing row before regenerating so we can invalidate
  // both the old and new keys in the in-process cache.
  const existing = await getIntegration(tenantId, req.params.id);
  invalidateCache(existing.apiKey);
  const row = await regenerateApiKey(tenantId, req.params.id);
  invalidateCache(row.apiKey);
  res.json(row);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const existing = await getIntegration(tenantId, req.params.id).catch(() => null);
  if (existing) invalidateCache(existing.apiKey);
  await deleteIntegration(tenantId, req.params.id);
  res.status(204).end();
});
