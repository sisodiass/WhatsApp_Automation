import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { create, getOne, list, patch, remove } from "./task.controller.js";

const WRITE = ["SUPER_ADMIN", "ADMIN", "AGENT"];

export const taskRouter = Router();
taskRouter.use(requireAuth);
taskRouter.get("/", list);
taskRouter.get("/:id", getOne);
taskRouter.post("/", requireRole(...WRITE), create);
taskRouter.patch("/:id", requireRole(...WRITE), patch);
taskRouter.delete("/:id", requireRole("SUPER_ADMIN", "ADMIN"), remove);
