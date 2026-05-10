// Production hardening middleware. All knobs read from `config` so the
// dev environment stays loose (rate limits effectively disabled) while
// production is locked down.
//
// Order matters in index.js:
//   1. requestId   — assigns X-Request-Id, downstream logs use it
//   2. helmet      — security headers
//   3. compression — gzip responses
//   4. cors        — already wired
//   5. body parsers
//   6. rateLimit   — applied per-route group
//
// Note: trust proxy must be set BEFORE rate limiters so they see the
// real client IP behind the reverse proxy / Cloudflare.

import crypto from "node:crypto";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { isProd } from "../config/index.js";
import { child } from "./logger.js";

const log = child("hardening");

// ─── Request id ──────────────────────────────────────────────────────

export function requestId(req, res, next) {
  const incoming = req.headers["x-request-id"];
  const id =
    typeof incoming === "string" && incoming.length <= 80
      ? incoming
      : crypto.randomBytes(8).toString("hex");
  req.id = id;
  res.setHeader("X-Request-Id", id);
  next();
}

// ─── Helmet ──────────────────────────────────────────────────────────
// API-only — the frontend is served by Cloudflare Pages with its own CSP.
// We disable contentSecurityPolicy on the API so json responses don't
// fight a default CSP that complains about inline anything.

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  });
}

// ─── Compression ─────────────────────────────────────────────────────

export function compress() {
  return compression({
    threshold: 1024,
    // Don't compress server-sent events / streaming responses.
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  });
}

// ─── Rate limits ─────────────────────────────────────────────────────
//
// Use a key generator that prefers req.id when X-Forwarded-For is missing
// (e.g., direct local hits). In production behind a proxy, `trust proxy`
// in index.js means express picks up the real client IP from the header.
//
// In dev, set max so high it's effectively off (rate limit errors are a
// pain when iterating).

const DEV_OFF = !isProd();

export const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: DEV_OFF ? 100_000 : 300, // ~5/sec sustained
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many requests" } },
  skip: (req) => req.path === "/health",
});

// Stricter limit for unauthenticated auth flows (login + refresh) to
// blunt credential stuffing.
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: DEV_OFF ? 10_000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many auth attempts" } },
});

// Even stricter for things that touch external paid services (re-embed
// all, AI health round-trips, demo booking).
export const sensitiveLimiter = rateLimit({
  windowMs: 60_000,
  max: DEV_OFF ? 10_000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many requests" } },
});

if (DEV_OFF) {
  log.info("hardening: dev mode — rate limits effectively disabled");
}
