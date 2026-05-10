import { Router } from "express";
import { login, refresh, me, logout } from "./auth.controller.js";
import { requireAuth, requireRole } from "./auth.middleware.js";

export const authRouter = Router();

authRouter.post("/login", login);
authRouter.post("/refresh", refresh);
authRouter.post("/logout", logout);
authRouter.get("/me", requireAuth, me);

// Demo endpoint to prove RBAC works (used in Phase 1 acceptance check).
authRouter.get(
  "/_super-only",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  (_req, res) => res.json({ ok: true, message: "you are super admin" }),
);
