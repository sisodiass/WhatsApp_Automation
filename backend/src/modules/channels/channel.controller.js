import { z } from "zod";
import { asyncHandler, BadRequest, NotFound } from "../../shared/errors.js";
import {
  deleteChannel,
  getChannelByType,
  listChannels,
  redactSecrets,
  upsertChannelByType,
} from "./channel.service.js";

const typeSchema = z.enum(["WHATSAPP", "INSTAGRAM", "FB_MESSENGER", "WEB_CHAT"]);

const upsertSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.any()).nullable().optional(),
});

export const list = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const items = await listChannels(tenantId);
  // List view always redacts secrets.
  res.json({ items: items.map(redactSecrets) });
});

// Single-channel fetch for the edit form. Returns secrets in cleartext
// because the operator needs to see / edit them; the response carries
// no-cache headers to discourage accidental UI bleed.
export const getOne = asyncHandler(async (req, res) => {
  const parsedType = typeSchema.safeParse(req.params.type?.toUpperCase());
  if (!parsedType.success) throw BadRequest("invalid channel type");
  const tenantId = req.auth.tenantId;
  const channel = await getChannelByType(tenantId, parsedType.data);
  if (!channel) throw NotFound("channel not found");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(channel);
});

export const upsert = asyncHandler(async (req, res) => {
  const parsedType = typeSchema.safeParse(req.params.type?.toUpperCase());
  if (!parsedType.success) throw BadRequest("invalid channel type");
  const parsed = upsertSchema.safeParse(req.body || {});
  if (!parsed.success) throw BadRequest("invalid payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const channel = await upsertChannelByType(tenantId, parsedType.data, parsed.data);
  res.json(channel);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  await deleteChannel(tenantId, req.params.id);
  res.status(204).end();
});
