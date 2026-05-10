import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { full } from "./health.controller.js";

export const healthRouter = Router();
healthRouter.use(requireAuth);
healthRouter.get("/full", full);
