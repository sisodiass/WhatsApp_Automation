import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { create, getOne, list, patch, remove, rotate } from "./integration.controller.js";

const ADMIN = ["SUPER_ADMIN", "ADMIN"];

export const integrationRouter = Router();
integrationRouter.use(requireAuth);

integrationRouter.get("/", requireRole(...ADMIN), list);
integrationRouter.get("/:id", requireRole(...ADMIN), getOne);
integrationRouter.post("/", requireRole(...ADMIN), create);
integrationRouter.patch("/:id", requireRole(...ADMIN), patch);
integrationRouter.post("/:id/rotate-key", requireRole(...ADMIN), rotate);
integrationRouter.delete("/:id", requireRole(...ADMIN), remove);
