// Phase 8 settings engine.
//
// On read:
//   - per-process 30s cache (multi-process drift bounded by TTL)
//   - decrypts secret rows transparently (encrypted=true on the row)
//
// On write (setSetting):
//   - encrypts the value if the key is in the secret allowlist or matches
//     a secret-suffix regex (.api_key / .secret / .password / .credentials)
//   - writes a row to settings_audit_logs with old + new (secrets logged
//     as "<encrypted>" placeholders so audit logs stay safe to share)
//   - busts the per-process cache for the key
//   - invalidates the AI provider factory if a provider/model key changed
//
// Secrets in process memory: the cache holds plaintext for up to 30s.
// Acceptable trade-off — encryption protects "DB dump" leaks, not "RAM
// snapshot of a running Node process" leaks.

import { prisma } from "../../shared/prisma.js";
import { decrypt, encrypt } from "../../utils/crypto.js";
import { invalidateProvider } from "../ai/providers/index.js";

// Keys that must always be encrypted at rest. Add API keys / OAuth secrets
// here; the regex below also catches anything ending in a secret suffix.
const SECRET_KEYS = new Set([
  "ai.openai.api_key",
  "ai.gemini.api_key",
  "microsoft.client_secret",
]);

const SECRET_SUFFIX_RE = /\.(api_key|secret|password|credentials?)$/;

// Keys whose change drops the cached AI provider so the next caller picks
// up the new model / api key. Add to this list when other modules grow
// caches keyed on settings.
const PROVIDER_KEYS = new Set([
  "ai.provider",
  "ai.openai.api_key",
  "ai.openai.chat_model",
  "ai.openai.embedding_model",
  "ai.gemini.api_key",
  "ai.gemini.chat_model",
  "ai.gemini.embedding_model",
]);

export function isSecretKey(key) {
  return SECRET_KEYS.has(key) || SECRET_SUFFIX_RE.test(key);
}

// ─── Per-process cache ──────────────────────────────────────────────

const CACHE_TTL_MS = 30_000;
const cache = new Map(); // `${tenantId}|${key}` → { v, expiresAt }

function cacheGet(tenantId, key) {
  const k = `${tenantId}|${key}`;
  const e = cache.get(k);
  if (!e) return undefined;
  if (e.expiresAt < Date.now()) {
    cache.delete(k);
    return undefined;
  }
  return e.v;
}
function cacheSet(tenantId, key, value) {
  cache.set(`${tenantId}|${key}`, { v: value, expiresAt: Date.now() + CACHE_TTL_MS });
}
function cacheDel(tenantId, key) {
  cache.delete(`${tenantId}|${key}`);
}

// ─── Read ───────────────────────────────────────────────────────────

function decryptedValue(row) {
  if (!row) return undefined;
  if (row.encrypted) {
    try {
      return decrypt(row.value);
    } catch {
      return undefined; // corrupted / wrong key — caller falls back
    }
  }
  return row.value;
}

export async function getSetting(tenantId, key, fallback) {
  const cached = cacheGet(tenantId, key);
  if (cached !== undefined) return cached;

  const row = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key } },
  });
  const v = decryptedValue(row);
  const out = v === undefined ? fallback : v;
  cacheSet(tenantId, key, out);
  return out;
}

export async function getSettings(tenantId, keys) {
  const out = {};
  const missing = [];
  for (const k of keys) {
    const c = cacheGet(tenantId, k);
    if (c !== undefined) out[k] = c;
    else missing.push(k);
  }
  if (missing.length) {
    const rows = await prisma.setting.findMany({
      where: { tenantId, key: { in: missing } },
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    for (const k of missing) {
      const v = decryptedValue(byKey[k]);
      out[k] = v;
      if (v !== undefined) cacheSet(tenantId, k, v);
    }
  }
  return out;
}

// ─── Write ───────────────────────────────────────────────────────────

export async function setSetting({ tenantId, key, value, changedById }) {
  const isSecret = isSecretKey(key);
  const storedValue = isSecret ? encrypt(value) : value;

  // Read old row first so we can populate the audit log.
  const existing = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key } },
  });

  const oldForLog = existing
    ? existing.encrypted
      ? "<encrypted>"
      : existing.value
    : null;
  const newForLog = isSecret ? "<encrypted>" : value;

  const [row] = await prisma.$transaction([
    prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { value: storedValue, encrypted: isSecret, updatedById: changedById || null },
      create: {
        tenantId,
        key,
        value: storedValue,
        encrypted: isSecret,
        updatedById: changedById || null,
      },
    }),
    prisma.settingAuditLog.create({
      data: {
        tenantId,
        key,
        oldValue: oldForLog,
        newValue: newForLog,
        changedById: changedById || null,
      },
    }),
  ]);

  cacheDel(tenantId, key);
  if (PROVIDER_KEYS.has(key)) invalidateProvider();

  return row;
}

// ─── Audit log read ──────────────────────────────────────────────────

export async function listAuditLog(tenantId, { key, limit = 100 } = {}) {
  return prisma.settingAuditLog.findMany({
    where: { tenantId, ...(key ? { key } : {}) },
    orderBy: { changedAt: "desc" },
    take: Math.min(limit, 500),
    include: { changedBy: { select: { id: true, email: true, name: true } } },
  });
}
