import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { create, list, patch, remove } from "./template.controller.js";

export const templateRouter = Router();
templateRouter.use(requireAuth);

templateRouter.get("/", list);
templateRouter.post("/", requireRole("SUPER_ADMIN", "ADMIN"), create);
templateRouter.patch("/:id", requireRole("SUPER_ADMIN", "ADMIN"), patch);
templateRouter.delete("/:id", requireRole("SUPER_ADMIN", "ADMIN"), remove);
