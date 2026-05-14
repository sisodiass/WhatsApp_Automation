// Public router. Every endpoint is gated by:
//   1. validatePublicApiKey  → req.integration
//   2. checkAllowedDomain    → 403 if Origin not on allowlist
//   3. perKeyRateLimit       → 429 if over budget
//
// CORS is permissive (origin: true, credentials: false) at the mount
// in src/index.js — restriction happens via the allowedDomains check,
// not via CORS preflight.

import { Router } from "express";
import {
  chatInit,
  chatPoll,
  chatSend,
  lead,
  widgetConfig,
  widgetSession,
} from "./public.controller.js";
import {
  checkAllowedDomain,
  perKeyRateLimit,
  validatePublicApiKey,
} from "./public.middleware.js";

export const publicRouter = Router();

// Everything goes through key validation. Domain + rate limit are
// stacked after so 401s are returned BEFORE 403/429 — easier debugging
// for integrators.
publicRouter.use(validatePublicApiKey);
publicRouter.use(checkAllowedDomain);
publicRouter.use(perKeyRateLimit());

// ─── Widget bootstrap ──────────────────────────────────────────────
publicRouter.get("/widget/config", widgetConfig);
publicRouter.post("/widget/session", widgetSession);

// ─── Chat (post-session) ───────────────────────────────────────────
publicRouter.post("/chat/init", chatInit);
publicRouter.post("/chat/send", chatSend);
publicRouter.get("/chat/messages", chatPoll);

// ─── One-shot lead capture ─────────────────────────────────────────
publicRouter.post("/lead-capture", lead);
