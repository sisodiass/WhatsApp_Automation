import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { create, getOne, list, logs, patch, remove } from "./followup.controller.js";

const ADMIN = ["SUPER_ADMIN", "ADMIN"];
const VIEW = ["SUPER_ADMIN", "ADMIN", "AGENT", "VIEWER"];

export const followupRouter = Router();
followupRouter.use(requireAuth);

// "/logs" sits above ":id" so the route matcher doesn't shadow it.
followupRouter.get("/logs", requireRole(...VIEW), logs);
followupRouter.get("/", requireRole(...VIEW), list);
followupRouter.get("/:id", requireRole(...VIEW), getOne);
followupRouter.post("/", requireRole(...ADMIN), create);
followupRouter.patch("/:id", requireRole(...ADMIN), patch);
followupRouter.delete("/:id", requireRole(...ADMIN), remove);
