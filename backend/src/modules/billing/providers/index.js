// Billing provider factory. Same shape as the AI / payments / email
// factories. Reads credentials from the default tenant's Setting table
// (the operator pays Stripe, not individual tenants).

import crypto from "node:crypto";
import { child } from "../../../shared/logger.js";
import { prisma } from "../../../shared/prisma.js";
import { getDefaultTenantId } from "../../../shared/tenant.js";
import { decrypt } from "../../../utils/crypto.js";
import { validateCheckoutInput, validatePortalInput } from "./base.js";
import { createStripeProvider } from "./stripe.provider.js";

const log = child("billing-provider");

const SETTING_KEYS = [
  "billing.stripe.secret_key",
  "billing.stripe.webhook_secret",
  "billing.stripe.publishable_key",
];

// Stub — used when no Stripe secret is configured AND in tests
// (BILLING_STUB=true). Simulates a successful checkout by:
//   - returning a fake URL that the frontend can redirect to (in dev,
//     operators replace this with their real Stripe sandbox URL)
//   - recording everything in an in-memory log inspectable from tests
const _stubLog = [];

function createStubProvider() {
  return {
    name: "stub",
    async createCheckoutSession(input) {
      validateCheckoutInput(input);
      const id = `cs_stub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const url = `${input.successUrl}?session_id=${id}&stub=1`;
      _stubLog.push({ kind: "checkout", input, sessionId: id });
      log.info("[stub] checkout session", { id, planSlug: input.planSlug });
      return { url, sessionId: id };
    },
    async createPortalSession(input) {
      validatePortalInput(input);
      _stubLog.push({ kind: "portal", input });
      return { url: `${input.returnUrl}?stub_portal=1` };
    },
    verifyWebhookSignature() {
      return true; // stub skips signature in dev/tests
    },
    parseWebhookEvent({ rawBody }) {
      const event = JSON.parse(rawBody.toString("utf8"));
      return {
        id: event.id || `evt_stub_${Date.now()}`,
        type: event.type,
        livemode: false,
        data: event.data || {},
        raw: event,
      };
    },
    async healthCheck() {
      return { provider: "stub", ok: true };
    },
  };
}

export function getStubBillingLog() {
  return [..._stubLog];
}

export function clearStubBillingLog() {
  _stubLog.length = 0;
}

async function readSettings(tenantId, keys) {
  const rows = await prisma.setting.findMany({
    where: { tenantId, key: { in: keys } },
  });
  const out = {};
  for (const r of rows) {
    out[r.key] = r.encrypted ? safeDecrypt(r.value) : r.value;
  }
  return out;
}

function safeDecrypt(v) {
  try {
    return decrypt(v);
  } catch {
    return null;
  }
}

let cached = null;

function fingerprint(s) {
  if (!s) return "none";
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
}

// Returns the active billing provider + the operator's settings needed
// to drive a checkout flow (publishable key for the frontend; webhook
// secret for verifyWebhookSignature). Auto-falls back to STUB when no
// Stripe secret is configured — keeps dev/test environments working
// without a Stripe account.
export async function getBillingProvider() {
  if (process.env.BILLING_STUB === "true") {
    if (cached?.signature === "stub-forced") return cached;
    const stub = createStubProvider();
    cached = { signature: "stub-forced", provider: stub, secrets: {} };
    return cached;
  }

  const tenantId = await getDefaultTenantId();
  const cfg = await readSettings(tenantId, SETTING_KEYS);
  const secretKey = cfg["billing.stripe.secret_key"] || "";
  const webhookSecret = cfg["billing.stripe.webhook_secret"] || "";
  const publishableKey = cfg["billing.stripe.publishable_key"] || "";

  if (!secretKey) {
    // No Stripe configured → STUB. Operators get the same shape; they
    // just don't take real money until they paste a secret_key in.
    if (cached?.signature === "stub-fallback") return cached;
    const stub = createStubProvider();
    cached = {
      signature: "stub-fallback",
      provider: stub,
      secrets: { publishableKey, webhookSecret: "" },
    };
    return cached;
  }

  const sig = `stripe|${fingerprint(secretKey)}|${fingerprint(webhookSecret)}`;
  if (cached?.signature === sig) return cached;
  log.info("instantiating billing provider", {
    name: "stripe",
    hasWebhookSecret: Boolean(webhookSecret),
  });
  cached = {
    signature: sig,
    provider: createStripeProvider({ secretKey }),
    secrets: { publishableKey, webhookSecret },
  };
  return cached;
}

export function invalidateBillingProvider() {
  cached = null;
}
