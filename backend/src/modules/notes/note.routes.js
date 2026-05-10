import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { create, list, remove } from "./note.controller.js";

export const noteRouter = Router();
noteRouter.use(requireAuth);

const ACTOR = ["SUPER_ADMIN", "ADMIN", "AGENT"];

noteRouter.get("/chats/:chatId/notes", list);
noteRouter.post("/chats/:chatId/notes", requireRole(...ACTOR), create);
noteRouter.delete("/notes/:id", requireRole(...ACTOR), remove);
