import { Router } from "express";
import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { scoreLead, suggestReplies } from "./scoring.service.js";

// Mounted under /api. Provides:
//   POST /api/leads/:id/score
//   POST /api/chats/:chatId/suggest-replies?tone=
//
// Both round-trip to the configured AI provider, so the parent mount
// (in src/index.js) wraps with sensitiveLimiter.

const WRITE = ["SUPER_ADMIN", "ADMIN", "AGENT"];

export const aiScoringRouter = Router();
aiScoringRouter.use(requireAuth);

aiScoringRouter.post(
  "/leads/:id/score",
  requireRole(...WRITE),
  asyncHandler(async (req, res) => {
    const tenantId = req.auth.tenantId;
    const result = await scoreLead(tenantId, req.params.id, req.user?.id);
    res.json(result);
  }),
);

const suggestSchema = z.object({
  tone: z.enum(["professional", "friendly", "brief"]).optional(),
});

aiScoringRouter.post(
  "/chats/:chatId/suggest-replies",
  requireRole(...WRITE),
  asyncHandler(async (req, res) => {
    const parsed = suggestSchema.safeParse(req.body || {});
    if (!parsed.success) throw BadRequest("invalid suggest payload", parsed.error.flatten());
    const tenantId = req.auth.tenantId;
    const result = await suggestReplies(tenantId, req.params.chatId, parsed.data);
    res.json(result);
  }),
);
