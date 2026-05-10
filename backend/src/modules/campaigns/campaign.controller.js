import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
} from "./campaign.service.js";
import { createCampaignSchema, updateCampaignSchema } from "./campaign.validators.js";

export const list = asyncHandler(async (_req, res) => {
  const tenantId = await getDefaultTenantId();
  const items = await listCampaigns(tenantId);
  res.json({ items });
});

export const create = asyncHandler(async (req, res) => {
  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid campaign payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const campaign = await createCampaign(tenantId, parsed.data);
  res.status(201).json(campaign);
});

export const get = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const campaign = await getCampaign(tenantId, req.params.id);
  res.json(campaign);
});

export const update = asyncHandler(async (req, res) => {
  const parsed = updateCampaignSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid campaign payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const campaign = await updateCampaign(tenantId, req.params.id, parsed.data);
  res.json(campaign);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  await deleteCampaign(tenantId, req.params.id);
  res.status(204).end();
});
