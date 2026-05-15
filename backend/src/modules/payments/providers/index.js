// Payments provider factory. Mirrors the AI provider factory pattern in
// modules/ai/providers/index.js:
//   - Reads active provider + per-provider creds from the Settings table
//   - Decrypts encrypted-at-rest secrets
//   - Caches a single instance per (provider, key-fingerprint) signature
//   - `invalidateProvider()` is called by settings.service after any
//     payments.* change.
//
// Feature code never imports razorpay/stripe SDKs directly — everything
// goes through getPaymentProvider() (and the providers/*.provider.js
// files are the only ones that talk to those APIs).

import crypto from "node:crypto";
import { prisma } from "../../../shared/prisma.js";
import { child } from "../../../shared/logger.js";
import { getDefaultTenantId } from "../../../shared/tenant.js";
import { decrypt } from "../../../utils/crypto.js";
import { createRazorpayProvider } from "./razorpay.provider.js";
import { createStripeProvider } from "./stripe.provider.js";
import { createStubProvider } from "./stub.provider.js";

const log = child("payments-provider");

async function readSettings(tenantId, keys) {
  const rows = await prisma.setting.findMany({
    where: { tenantId, key: { in: keys } },
  });
  const out = {};
  for (const r of rows) {
    if (r.encrypted) {
      try {
        out[r.key] = decrypt(r.value);
      } catch {
        // skip — corrupted / wrong key
      }
    } else {
      out[r.key] = r.value;
    }
  }
  return out;
}

function fingerprint(s) {
  if (!s) return "none";
  return crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 8);
}

let cached = null; // { signature, provider, providerName }

const REGISTRY = {
  RAZORPAY: ({ cfg }) =>
    createRazorpayProvider({
      keyId: cfg["payments.razorpay.key_id"],
      keySecret: cfg["payments.razorpay.key_secret"],
    }),
  STRIPE: ({ cfg }) =>
    createStripeProvider({
      secretKey: cfg["payments.stripe.secret_key"],
    }),
  STUB: () => createStubProvider(),
};

export async function getPaymentProvider(opts = {}) {
  // PAYMENTS_STUB=true forces the stub (mirrors AI_STUB). Useful for tests
  // and CI environments without payment-gateway credentials.
  const stubFlag =
    process.env.PAYMENTS_STUB === "true" || opts.forceStub === true;

  const tenantId = await getDefaultTenantId();
  const cfg = await readSettings(tenantId, [
    "payments.default_provider",
    "payments.razorpay.key_id",
    "payments.razorpay.key_secret",
    "payments.razorpay.webhook_secret",
    "payments.stripe.secret_key",
    "payments.stripe.publishable_key",
    "payments.stripe.webhook_secret",
  ]);

  let name = String(cfg["payments.default_provider"] || "STUB").toUpperCase();
  if (stubFlag) name = "STUB";
  if (!REGISTRY[name]) {
    log.warn("unknown payments provider, falling back to STUB", { name });
    name = "STUB";
  }

  const keyMaterial =
    name === "RAZORPAY"
      ? cfg["payments.razorpay.key_id"]
      : name === "STRIPE"
      ? cfg["payments.stripe.secret_key"]
      : "stub";
  const sig = `${name}|${fingerprint(keyMaterial)}`;

  if (cached && cached.signature === sig) {
    return { providerName: name, provider: cached.provider };
  }

  log.info("instantiating payments provider", { name, keyFingerprint: fingerprint(keyMaterial) });
  const provider = REGISTRY[name]({ cfg });
  cached = { signature: sig, provider, providerName: name };
  return { providerName: name, provider };
}

export function invalidatePaymentsProvider() {
  cached = null;
}

// Provider-specific webhook secret resolver. The webhook route uses this
// to verify signatures; it accepts the provider name from the URL, NOT
// from the current default — so a tenant in the middle of switching
// providers still receives in-flight webhooks from the old provider.
export async function getWebhookSecret(providerName) {
  const tenantId = await getDefaultTenantId();
  const key =
    providerName === "RAZORPAY"
      ? "payments.razorpay.webhook_secret"
      : providerName === "STRIPE"
      ? "payments.stripe.webhook_secret"
      : null;
  if (!key) return null;
  const cfg = await readSettings(tenantId, [key]);
  return cfg[key] || null;
}

// Look up a specific provider by name (used by the webhook route, which
// can't rely on `default_provider` since both providers may be active
// concurrently during migration).
export async function getProviderByName(name) {
  const tenantId = await getDefaultTenantId();
  const cfg = await readSettings(tenantId, [
    "payments.razorpay.key_id",
    "payments.razorpay.key_secret",
    "payments.stripe.secret_key",
  ]);
  const upper = String(name || "").toUpperCase();
  if (!REGISTRY[upper]) throw new Error(`unknown payments provider: ${name}`);
  return REGISTRY[upper]({ cfg });
}

export function listPaymentProviders() {
  return Object.keys(REGISTRY);
}
