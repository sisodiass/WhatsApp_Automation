// WebsiteIntegration CRUD. One row per "website embedding our widget
// or calling our public API". The apiKey is the credential we hand to
// the operator; treat it like a password (don't log, redact in list
// responses, support rotation).

import crypto from "node:crypto";
import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";

const KEY_PREFIX = "site_";

function generateApiKey() {
  // 32 bytes of randomness → 64 hex chars; prefixed for human recognition
  // and to make accidental commits to GitHub easier to grep.
  return KEY_PREFIX + crypto.randomBytes(24).toString("hex");
}

// Normalize an allowed-domains list. Strip protocol, trailing slash, and
// lowercase. We don't support wildcards in v1; operators add explicit
// hostnames (e.g. "www.example.com" + "example.com").
function normalizeDomains(domains) {
  if (!Array.isArray(domains)) return [];
  return domains
    .map((d) => String(d || "").trim().toLowerCase())
    .map((d) => d.replace(/^https?:\/\//, ""))
    .map((d) => d.replace(/\/.*$/, ""))
    .map((d) => d.replace(/:\d+$/, "")) // strip port
    .filter(Boolean);
}

// Public-shape: shown in list views; key is redacted to last 4 chars so
// the admin can identify the row but can't accidentally leak via the UI.
export function redactKey(integration) {
  if (!integration?.apiKey) return integration;
  const k = integration.apiKey;
  return { ...integration, apiKey: `${KEY_PREFIX}…${k.slice(-4)}` };
}

export function listIntegrations(tenantId) {
  return prisma.websiteIntegration.findMany({
    where: { tenantId },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  }).then((rows) => rows.map(redactKey));
}

// Single fetch for the edit view — returns the full key in cleartext.
// Cache-Control: no-store at the controller layer.
export async function getIntegration(tenantId, id) {
  const row = await prisma.websiteIntegration.findFirst({
    where: { id, tenantId },
  });
  if (!row) throw NotFound("integration not found");
  return row;
}

export async function createIntegration(tenantId, data, createdById) {
  if (!data.name?.trim()) throw BadRequest("name required");
  return prisma.websiteIntegration.create({
    data: {
      tenantId,
      name: data.name.trim(),
      apiKey: generateApiKey(),
      allowedDomains: normalizeDomains(data.allowedDomains),
      isActive: data.isActive ?? true,
      widgetEnabled: data.widgetEnabled ?? true,
      rateLimitPerMinute: clampInt(data.rateLimitPerMinute, 60, 1, 10000),
      widgetConfig: data.widgetConfig ?? null,
      createdById: createdById ?? null,
    },
  });
}

export async function updateIntegration(tenantId, id, data) {
  const existing = await prisma.websiteIntegration.findFirst({
    where: { id, tenantId },
  });
  if (!existing) throw NotFound("integration not found");
  const patch = {};
  if (data.name !== undefined) patch.name = String(data.name).trim();
  if (data.allowedDomains !== undefined) patch.allowedDomains = normalizeDomains(data.allowedDomains);
  if (data.isActive !== undefined) patch.isActive = data.isActive;
  if (data.widgetEnabled !== undefined) patch.widgetEnabled = data.widgetEnabled;
  if (data.rateLimitPerMinute !== undefined) patch.rateLimitPerMinute = clampInt(data.rateLimitPerMinute, 60, 1, 10000);
  if (data.widgetConfig !== undefined) patch.widgetConfig = data.widgetConfig;
  return prisma.websiteIntegration.update({ where: { id }, data: patch });
}

// Rotates the apiKey. The old key stops working immediately — the
// operator needs to update their site / API consumers.
export async function regenerateApiKey(tenantId, id) {
  const existing = await prisma.websiteIntegration.findFirst({
    where: { id, tenantId },
  });
  if (!existing) throw NotFound("integration not found");
  return prisma.websiteIntegration.update({
    where: { id },
    data: { apiKey: generateApiKey() },
  });
}

export async function deleteIntegration(tenantId, id) {
  const existing = await prisma.websiteIntegration.findFirst({
    where: { id, tenantId },
  });
  if (!existing) throw NotFound("integration not found");
  await prisma.websiteIntegration.delete({ where: { id } });
  return { ok: true };
}

// Look up by api key for the public-api middleware. Returns null on miss
// (middleware turns that into 401). Caches at the in-process level for a
// short window because the public API is hit frequently — the cache also
// degrades gracefully (apiKey rotation invalidates within ~60s).
const _cache = new Map(); // apiKey → { row, expiresAt }
const CACHE_TTL = 60_000;

export async function findByApiKey(apiKey) {
  if (!apiKey || !apiKey.startsWith(KEY_PREFIX)) return null;
  const cached = _cache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) return cached.row;
  const row = await prisma.websiteIntegration.findUnique({
    where: { apiKey },
  });
  if (row?.isActive) {
    _cache.set(apiKey, { row, expiresAt: Date.now() + CACHE_TTL });
  }
  return row?.isActive ? row : null;
}

// Called from updateIntegration / regenerate / delete so the cache
// doesn't serve stale rows. Cheap — Map size is bounded by active keys.
export function invalidateCache(apiKey) {
  if (apiKey) _cache.delete(apiKey);
  else _cache.clear();
}

// Check that the request's origin/referer is on the allowlist for this
// integration. Empty allowlist = permissive (dev convenience); a real
// production integration should always populate domains.
export function isOriginAllowed(integration, origin) {
  const domains = integration.allowedDomains || [];
  if (domains.length === 0) return true;
  if (!origin) return false;
  let host;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    host = String(origin).toLowerCase();
  }
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
