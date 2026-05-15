import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import { prisma } from "../../shared/prisma.js";
import { getSettings, isSecretKey, listAuditLog, setSetting } from "./settings.service.js";

// Allowlist of keys writable through the public PUT endpoint. Anything
// else 403s — prevents accidental writes to internal-only keys.
const WRITABLE = new Set([
  // AI
  "ai.global_enabled",
  "ai.provider",
  "ai.confidence_threshold",
  "ai.max_replies_per_session",
  "ai.concurrent_retrieval_limit",
  "ai.generation_timeout_seconds",
  "ai.openai.api_key",
  "ai.openai.chat_model",
  "ai.openai.embedding_model",
  "ai.gemini.api_key",
  "ai.gemini.chat_model",
  "ai.gemini.embedding_model",
  // Session
  "session.inactivity_reset_days",
  "session.resume_after_hours",
  // WhatsApp
  "wa.delay_min_seconds",
  "wa.delay_max_seconds",
  "wa.outbound_per_minute_max",
  "wa.warmup_mode",
  "wa.warmup_outbound_per_minute_max",
  "wa.warmup_delay_min_seconds",
  "wa.warmup_delay_max_seconds",
  // Manual queue
  "manual_queue.sla_minutes",
  // Microsoft Graph (Phase 9)
  "microsoft.tenant_id",
  "microsoft.client_id",
  "microsoft.client_secret",
  "microsoft.organizer_user_id",
  // M11 — Payments
  "payments.default_provider",
  "payments.currency_default",
  "payments.link_expiry_hours",
  "payments.razorpay.key_id",
  "payments.razorpay.key_secret",
  "payments.razorpay.webhook_secret",
  "payments.stripe.publishable_key",
  "payments.stripe.secret_key",
  "payments.stripe.webhook_secret",
  // M11 — Quotations
  "quotations.number_prefix",
  "quotations.number_format",
  "quotations.default_validity_days",
  "quotations.tax_rate_default",
  "quotations.approval_threshold_amount",
  "quotations.terms_default",
  "invoices.number_prefix",
  "invoices.number_format",
]);

const valueSchema = z.object({ value: z.any() });

export const getAll = asyncHandler(async (_req, res) => {
  const tenantId = await getDefaultTenantId();
  const rows = await prisma.setting.findMany({
    where: { tenantId },
    orderBy: { key: "asc" },
  });
  // Mask encrypted values; UI shows "set new" instead of plaintext.
  // hasValue must distinguish "real value" from "empty placeholder seeded
  // for UI grouping" (see seed.js for microsoft.* keys) — otherwise the
  // SecretInput shows "•••••• / Replace" for unset secrets.
  const items = rows.map((r) => ({
    key: r.key,
    value: r.encrypted ? null : r.value,
    encrypted: r.encrypted,
    hasValue: r.value !== null && r.value !== undefined && r.value !== "",
    updatedAt: r.updatedAt,
  }));
  res.json({ items, writable: [...WRITABLE] });
});

export const getByKeys = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const keys = String(req.query.keys || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) return res.json({});
  const out = await getSettings(tenantId, keys);
  // Don't return secret values via lookup. There's no UX reason to surface
  // plaintext API keys to the frontend even though it's behind auth.
  for (const k of keys) {
    if (isSecretKey(k) && out[k] !== undefined) out[k] = null;
  }
  res.json(out);
});

export const setOne = asyncHandler(async (req, res) => {
  const key = req.params.key;
  if (!WRITABLE.has(key)) throw BadRequest(`setting "${key}" is not writable via this endpoint`);
  const parsed = valueSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const row = await setSetting({
    tenantId,
    key,
    value: parsed.data.value,
    changedById: req.auth?.userId,
  });
  res.json({
    key: row.key,
    value: row.encrypted ? null : row.value,
    encrypted: row.encrypted,
    updatedAt: row.updatedAt,
  });
});

export const audit = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const limit = Math.min(parseInt(req.query.limit || "100", 10), 500);
  const items = await listAuditLog(tenantId, { key: req.query.key, limit });
  res.json({ items });
});
