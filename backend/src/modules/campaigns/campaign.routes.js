import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { create, get, list, remove, update } from "./campaign.controller.js";

export const campaignRouter = Router();

campaignRouter.use(requireAuth);

campaignRouter.get("/", list);
campaignRouter.get("/:id", get);
campaignRouter.post("/", requireRole("SUPER_ADMIN", "ADMIN"), create);
campaignRouter.patch("/:id", requireRole("SUPER_ADMIN", "ADMIN"), update);
campaignRouter.delete("/:id", requireRole("SUPER_ADMIN", "ADMIN"), remove);
