import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { getStatus, postLogout, postRestart } from "./whatsapp.controller.js";

export const whatsappRouter = Router();

whatsappRouter.get("/status", requireAuth, getStatus);
whatsappRouter.post("/logout", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), postLogout);
whatsappRouter.post("/restart", requireAuth, requireRole("SUPER_ADMIN", "ADMIN"), postRestart);
