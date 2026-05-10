import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import { bookDemo } from "./demo.service.js";
import { isConfigured } from "./teams.service.js";

const bookSchema = z.object({
  scheduledAt: z.string().min(1),
  durationMinutes: z.number().int().min(5).max(240).optional(),
  subject: z.string().max(200).optional(),
});

export const status = asyncHandler(async (_req, res) => {
  res.json({ configured: await isConfigured() });
});

export const book = asyncHandler(async (req, res) => {
  const parsed = bookSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid demo payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const result = await bookDemo({
    tenantId,
    chatId: req.params.chatId,
    scheduledAt: parsed.data.scheduledAt,
    durationMinutes: parsed.data.durationMinutes,
    subject: parsed.data.subject,
  });
  res.status(201).json(result);
});
