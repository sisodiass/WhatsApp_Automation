import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { getOne, list, remove, upsert } from "./channel.controller.js";

const ADMIN = ["SUPER_ADMIN", "ADMIN"];

export const channelRouter = Router();
channelRouter.use(requireAuth);

channelRouter.get("/", list);
channelRouter.get("/:type", requireRole(...ADMIN), getOne);
channelRouter.put("/:type", requireRole(...ADMIN), upsert);
channelRouter.delete("/:id", requireRole(...ADMIN), remove);
