import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { overview } from "./analytics.controller.js";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);
analyticsRouter.get("/overview", overview);
