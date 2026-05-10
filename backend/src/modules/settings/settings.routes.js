import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { audit, getAll, getByKeys, setOne } from "./settings.controller.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/", getAll);
settingsRouter.get("/lookup", getByKeys);
settingsRouter.get("/audit", requireRole("SUPER_ADMIN", "ADMIN"), audit);
settingsRouter.put("/:key", requireRole("SUPER_ADMIN", "ADMIN"), setOne);
