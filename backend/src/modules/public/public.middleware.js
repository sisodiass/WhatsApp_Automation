// Middleware for the /public/* routes. Three concerns layered:
//
//   1. validatePublicApiKey — extracts X-Api-Key header (or body.apiKey
//      fallback for embed forms that can't set custom headers), looks
//      up the integration, attaches req.integration.
//   2. checkAllowedDomain — verifies the request's Origin against the
//      integration's allowedDomains list. Bypassed when the list is
//      empty (dev convenience).
//   3. perKeyRateLimit — token-bucket-per-key in Redis. Per-key budget
//      comes from integration.rateLimitPerMinute.

import { redis } from "../../shared/redis.js";
import { child } from "../../shared/logger.js";
import { Unauthorized, Forbidden, AppError } from "../../shared/errors.js";
import { findByApiKey, isOriginAllowed } from "../integrations/integration.service.js";

const log = child("public-mw");

export async function validatePublicApiKey(req, _res, next) {
  // Header preferred; fall back to body.apiKey for HTML forms that can't
  // set custom headers (e.g. <form method=post> without JS).
  const header = req.headers["x-api-key"];
  const fromBody = req.body && typeof req.body === "object" ? req.body.apiKey : undefined;
  const apiKey = (header || fromBody || "").toString().trim();
  if (!apiKey) return next(Unauthorized("missing api key"));

  const integration = await findByApiKey(apiKey).catch((err) => {
    log.error("findByApiKey failed", { err: err.message });
    return null;
  });
  if (!integration) return next(Unauthorized("invalid or inactive api key"));

  req.integration = integration;
  req.tenantId = integration.tenantId;
  next();
}

export function checkAllowedDomain(req, _res, next) {
  if (!req.integration) return next(Unauthorized("api key not validated"));
  // Origin header is set by browsers on CORS requests; Referer is set
  // on most navigations. Server-to-server callers (curl, backends) may
  // send neither, in which case the allowlist applies only if populated.
  const origin = req.headers.origin || req.headers.referer || "";
  if (!isOriginAllowed(req.integration, origin)) {
    log.warn("blocked by allowedDomains", {
      integrationId: req.integration.id,
      origin,
      allowed: req.integration.allowedDomains,
    });
    return next(Forbidden("origin not allowed"));
  }
  next();
}

// Token-bucket-ish: increment a Redis counter keyed by api key + minute,
// reject when the integer exceeds the integration's per-minute budget.
// Trades exact precision (it's a fixed window, not sliding) for a single
// round-trip per request.
export function perKeyRateLimit() {
  return async function rateLimit(req, _res, next) {
    if (!req.integration) return next(Unauthorized("api key not validated"));
    const budget = req.integration.rateLimitPerMinute || 60;
    const window = Math.floor(Date.now() / 60_000);
    const key = `pubapi:rl:${req.integration.id}:${window}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 65); // tiny grace
      if (count > budget) {
        return next(new AppError(
          `rate limit exceeded (${budget}/min)`,
          429,
          "rate_limited",
        ));
      }
      next();
    } catch (err) {
      // Don't fail-closed on Redis outages; log and let the request through.
      log.warn("rate limit redis error (fail-open)", { err: err.message });
      next();
    }
  };
}
