import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { health, status } from "./ai.controller.js";

export const aiRouter = Router();

aiRouter.use(requireAuth);

// Cheap, anyone authenticated can read it (powers dashboard pill).
aiRouter.get("/status", status);

// Expensive (round-trips to provider). Admin-only.
aiRouter.get("/health", requireRole("SUPER_ADMIN", "ADMIN"), health);
