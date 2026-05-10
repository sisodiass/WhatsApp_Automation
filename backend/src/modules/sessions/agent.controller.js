import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import {
  claimManualQueueItem,
  listManualQueue,
  releaseManualQueueItem,
  resolveManualQueueItem,
  sendAgentReply,
  setSessionMode,
  setSessionState,
} from "./agent.service.js";

const replySchema = z.object({ body: z.string().min(1).max(4000) });
const modeSchema = z.object({ mode: z.enum(["AI", "MANUAL"]) });
const stateSchema = z.object({ state: z.enum(["ACTIVE", "PAUSED", "FOLLOWUP", "CLOSED"]) });

export const postAgentReply = asyncHandler(async (req, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid reply payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const out = await sendAgentReply({
    tenantId,
    chatId: req.params.chatId,
    body: parsed.data.body,
    authorId: req.auth?.userId,
  });
  res.status(202).json(out);
});

export const patchSessionMode = asyncHandler(async (req, res) => {
  const parsed = modeSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid mode payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const updated = await setSessionMode(tenantId, req.params.sessionId, parsed.data.mode);
  res.json(updated);
});

export const patchSessionState = asyncHandler(async (req, res) => {
  const parsed = stateSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid state payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const updated = await setSessionState(tenantId, req.params.sessionId, parsed.data.state);
  res.json(updated);
});

// ─── Manual queue ────────────────────────────────────────────────────

export const listQueue = asyncHandler(async (_req, res) => {
  const tenantId = await getDefaultTenantId();
  const items = await listManualQueue(tenantId);
  res.json({ items });
});

export const claimItem = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const item = await claimManualQueueItem(tenantId, req.params.itemId, req.auth.userId);
  res.json(item);
});

export const releaseItem = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const item = await releaseManualQueueItem(tenantId, req.params.itemId, req.auth.userId);
  res.json(item);
});

export const resolveItem = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const item = await resolveManualQueueItem(tenantId, req.params.itemId);
  res.json(item);
});
