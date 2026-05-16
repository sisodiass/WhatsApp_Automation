// M11.C3c — plan quota enforcement.
//
// Reads the active Subscription's Plan.limits map and the tenant's
// current usage, throws QuotaExceeded when an action would exceed
// its bucket. Compute-on-fly via Prisma COUNT — no separate
// counter table, no caching layer.
//
// Quota keys (must match Plan.limits values seeded by
// tenant-provisioning.service.js):
//
//   messages_per_month     — outbound messages this calendar month
//                              (counts AI + AGENT + CAMPAIGN sources;
//                              SYSTEM excluded since templates aren't
//                              billable).
//   contacts_max           — non-deleted Contact rows for the tenant.
//   ai_replies_per_month   — outbound messages with source=AI this
//                              calendar month. (Subset of
//                              messages_per_month — counted separately
//                              because the AI provider bill is the
//                              expensive one.)
//   automations_max        — active Automation rows.
//   channels_max           — Channel rows.
//   seats_max              — User rows in the tenant.
//
// `null` or absent in Plan.limits means "unlimited" — assertQuota
// short-circuits to OK for that key.
//
// No-cache design: we initially cached COUNTs for 60s but hit a
// staleness bug where assertQuota (read 0) + write + getCurrentUsage
// returned the stale 0. The fix was simpler than per-write
// invalidation: drop the cache. COUNT queries on the indexed columns
// (tenantId, createdAt, deletedAt) run in tens of milliseconds; at
// SaaS scale (10s-100s of tenants, 10s of thousands of rows) the
// overhead is invisible. Re-add a short-TTL cache later if a profiler
// proves it's worth the complexity.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { QuotaExceeded } from "../../shared/errors.js";
import { getSubscription } from "./billing.service.js";

const log = child("quota");

// Beginning of the current UTC calendar month. Used as the cut-off
// for monthly counters. Resets at the 1st of each month, 00:00 UTC.
function currentMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// Compute the per-key usage number live from Prisma. The Plan.limits
// map dictates which keys we care about; unknown keys return 0.
async function computeUsage(tenantId, key) {
  const monthStart = currentMonthStart();
  switch (key) {
    case "messages_per_month":
      return prisma.message.count({
        where: {
          direction: "OUT",
          source: { in: ["AI", "AGENT", "CAMPAIGN"] },
          createdAt: { gte: monthStart },
          session: { chat: { tenantId } },
        },
      });
    case "ai_replies_per_month":
      return prisma.message.count({
        where: {
          direction: "OUT",
          source: "AI",
          createdAt: { gte: monthStart },
          session: { chat: { tenantId } },
        },
      });
    case "contacts_max":
      return prisma.contact.count({
        where: { tenantId, deletedAt: null },
      });
    case "automations_max":
      return prisma.automation.count({
        where: { tenantId, isActive: true },
      });
    case "channels_max":
      return prisma.channel.count({ where: { tenantId } });
    case "seats_max":
      return prisma.user.count({ where: { tenantId, isActive: true } });
    default:
      return 0;
  }
}

// No-op alias retained so call sites + tests keep working. Was a
// cache lookup; now always live.
async function liveUsage(tenantId, key) {
  return computeUsage(tenantId, key);
}

// Forward-compatibility shim. Originally drained per-tenant cache
// entries from Redis; the cache is now gone (see file-level comment),
// so this is a no-op. Kept exported + non-async-safe so call sites
// in billing.service.applyPlanChange + the webhook update path
// continue to compile if/when we re-introduce caching later.
export async function invalidateTenantQuota(tenantId) {
  if (!tenantId) return;
  // Intentionally empty.
}

// Returns a flat map keyed by quota name with the current usage AND
// the active plan's limit. Used by the /billing page's usage display.
export async function getCurrentUsage(tenantId) {
  const sub = await getSubscription(tenantId);
  const limits = sub.plan.limits || {};
  const out = {};
  // Only surface keys present on the plan's limits map. Operators can
  // add new keys without touching this code; this loop picks them up.
  const keys = Object.keys(limits).length
    ? Object.keys(limits)
    : [
        "messages_per_month",
        "ai_replies_per_month",
        "contacts_max",
        "automations_max",
        "channels_max",
        "seats_max",
      ];
  for (const k of keys) {
    out[k] = {
      used: await liveUsage(tenantId, k),
      limit: limits[k] ?? null, // null = unlimited
    };
  }
  return { plan: { slug: sub.plan.slug, name: sub.plan.name }, items: out };
}

// Assert that ONE more unit of `key` fits inside the plan's limit.
// Throws QuotaExceeded (HTTP 402) with a structured details object the
// UI can render. Pass `increment` to check >1 (e.g. bulk import of 10
// contacts at once).
export async function assertQuota(tenantId, key, opts = {}) {
  if (!tenantId || !key) {
    throw new Error("assertQuota: tenantId + key required");
  }
  const increment = opts.increment ?? 1;
  const sub = await getSubscription(tenantId);
  const limit = sub.plan.limits?.[key];
  // null/undefined limit → unlimited on this plan.
  if (limit == null) return { allowed: true, limit: null };
  const used = await liveUsage(tenantId, key);
  if (used + increment > limit) {
    log.info("quota exceeded", {
      tenantId,
      key,
      used,
      limit,
      planSlug: sub.plan.slug,
    });
    throw QuotaExceeded(
      `${humanLabel(key)} quota reached for the ${sub.plan.name} plan (${used}/${limit}). Upgrade to a higher plan to continue.`,
      {
        quota: key,
        used,
        limit,
        planSlug: sub.plan.slug,
        upgradeTo: suggestUpgrade(sub.plan.slug),
      },
    );
  }
  return { allowed: true, used, limit, remaining: limit - used };
}

// Hot-path helper for AI-generation code that prefers a graceful
// FALLBACK over a hard 402. Returns boolean; never throws.
export async function isWithinQuota(tenantId, key, opts = {}) {
  try {
    await assertQuota(tenantId, key, opts);
    return true;
  } catch (err) {
    if (err?.code === "quota_exceeded") return false;
    throw err; // any other error (DB failure) propagates
  }
}

function humanLabel(key) {
  return (
    {
      messages_per_month: "Monthly message",
      ai_replies_per_month: "AI reply",
      contacts_max: "Contact",
      automations_max: "Automation",
      channels_max: "Channel",
      seats_max: "Team seat",
    }[key] || key
  );
}

// Suggested upgrade target — used to power the "Upgrade to X" copy in
// the QuotaExceeded error. Keep simple: free → starter → pro →
// enterprise. Operators can override per-tenant if needed.
function suggestUpgrade(currentSlug) {
  return (
    {
      free: "starter",
      starter: "pro",
      pro: "enterprise",
    }[currentSlug] || null
  );
}
