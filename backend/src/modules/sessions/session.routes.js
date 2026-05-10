import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { devBackdate, getMessages, listChats, listSessions } from "./session.controller.js";

export const sessionRouter = Router();

sessionRouter.use(requireAuth);

sessionRouter.get("/chats", listChats);
sessionRouter.get("/chats/:chatId/sessions", listSessions);
sessionRouter.get("/sessions/:sessionId/messages", getMessages);

// Dev tooling — only mounted in non-production envs.
sessionRouter.post(
  "/_dev/backdate-session",
  requireRole("SUPER_ADMIN", "ADMIN"),
  devBackdate,
);
