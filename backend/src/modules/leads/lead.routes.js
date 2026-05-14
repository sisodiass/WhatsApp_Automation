import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  addNote,
  board,
  create,
  getOne,
  list,
  moveStage,
  patch,
  remove,
} from "./lead.controller.js";

const WRITE = ["SUPER_ADMIN", "ADMIN", "AGENT"];

export const leadRouter = Router();
leadRouter.use(requireAuth);
leadRouter.get("/", list);
leadRouter.get("/board/:pipelineId", board);
leadRouter.get("/:id", getOne);
leadRouter.post("/", requireRole(...WRITE), create);
leadRouter.patch("/:id", requireRole(...WRITE), patch);
leadRouter.patch("/:id/stage", requireRole(...WRITE), moveStage);
leadRouter.post("/:id/notes", requireRole(...WRITE), addNote);
leadRouter.delete("/:id", requireRole("SUPER_ADMIN", "ADMIN"), remove);
