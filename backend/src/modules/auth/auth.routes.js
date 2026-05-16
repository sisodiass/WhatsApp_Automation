import { Router } from "express";
import {
  forgotPassword,
  login,
  logout,
  me,
  refresh,
  resendVerification,
  resetPassword,
  signup,
  signupEnabled,
  verifyEmail,
} from "./auth.controller.js";
import { requireAuth, requireRole } from "./auth.middleware.js";

export const authRouter = Router();

authRouter.post("/login", login);
authRouter.post("/refresh", refresh);
authRouter.post("/logout", logout);
authRouter.get("/me", requireAuth, me);

// M11.C1 — password reset + email verification. All four are PUBLIC.
// The two "request" endpoints (forgot-password, resend-verification)
// always return 200 even when the email isn't registered, to prevent
// account enumeration. The two "consume" endpoints (reset-password,
// verify-email) validate the token and return BadRequest on failure.
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPassword);
authRouter.post("/verify-email", verifyEmail);
authRouter.post("/resend-verification", resendVerification);

// M11.C2 — SaaS signup. Public. /signup creates Tenant + SUPER_ADMIN
// user + per-tenant scaffolding and returns tokens. /signup-enabled
// lets the frontend show/hide the link without exposing the setting.
authRouter.get("/signup-enabled", signupEnabled);
authRouter.post("/signup", signup);

// Demo endpoint to prove RBAC works (used in Phase 1 acceptance check).
authRouter.get(
  "/_super-only",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  (_req, res) => res.json({ ok: true, message: "you are super admin" }),
);
