import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { assign, create, list, patch, remove, unassign } from "./tag.controller.js";

const ACTOR = ["SUPER_ADMIN", "ADMIN", "AGENT"];

// Tag CRUD — mounted at /api/tags.
export const tagRouter = Router();
tagRouter.use(requireAuth);
tagRouter.get("/", list);
tagRouter.post("/", requireRole("SUPER_ADMIN", "ADMIN"), create);
tagRouter.patch("/:id", requireRole("SUPER_ADMIN", "ADMIN"), patch);
tagRouter.delete("/:id", requireRole("SUPER_ADMIN", "ADMIN"), remove);

// Chat ↔ tag assignment — mounted at /api so the URLs stay readable:
//   POST   /api/chats/:chatId/tags/:tagId
//   DELETE /api/chats/:chatId/tags/:tagId
export const chatTagRouter = Router();
chatTagRouter.use(requireAuth);
chatTagRouter.post("/chats/:chatId/tags/:tagId", requireRole(...ACTOR), assign);
chatTagRouter.delete("/chats/:chatId/tags/:tagId", requireRole(...ACTOR), unassign);
