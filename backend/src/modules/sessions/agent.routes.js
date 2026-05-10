import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  claimItem,
  listQueue,
  patchSessionMode,
  patchSessionState,
  postAgentReply,
  releaseItem,
  resolveItem,
} from "./agent.controller.js";

export const agentRouter = Router();

agentRouter.use(requireAuth);

// Agents and above can act on chats; viewers can read but not write.
const ACTOR_ROLES = ["SUPER_ADMIN", "ADMIN", "AGENT"];

// Agent reply on a chat → flips mode to MANUAL and enqueues outbound.
agentRouter.post("/chats/:chatId/messages", requireRole(...ACTOR_ROLES), postAgentReply);

// Mode + state controls.
agentRouter.patch("/sessions/:sessionId/mode", requireRole(...ACTOR_ROLES), patchSessionMode);
agentRouter.patch("/sessions/:sessionId/state", requireRole(...ACTOR_ROLES), patchSessionState);

// Manual queue.
agentRouter.get("/manual-queue", listQueue);
agentRouter.post("/manual-queue/:itemId/claim", requireRole(...ACTOR_ROLES), claimItem);
agentRouter.post("/manual-queue/:itemId/release", requireRole(...ACTOR_ROLES), releaseItem);
agentRouter.post("/manual-queue/:itemId/resolve", requireRole(...ACTOR_ROLES), resolveItem);
