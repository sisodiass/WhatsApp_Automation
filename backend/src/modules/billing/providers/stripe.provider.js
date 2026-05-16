// Stripe billing provider. Native fetch (no SDK dep — same pattern as
// the M11.A payment providers). Uses Stripe's REST API directly:
//
//   POST https://api.stripe.com/v1/checkout/sessions
//   POST https://api.stripe.com/v1/billing_portal/sessions
//
// Auth: Basic with the secret key as username (the empty password is
// implicit). Body is application/x-www-form-urlencoded — Stripe doesn't
// accept JSON.
//
// Webhook signature: Stripe-Signature header has a `t=` timestamp and
// one or more `v1=` HMAC-SHA256 signatures. We compute HMAC over
// `${t}.${rawBody}` with the webhook secret and compare against the
// v1 entries in constant time.

import crypto from "node:crypto";
import { validateCheckoutInput, validatePortalInput } from "./base.js";

const NAME = "stripe";
const API_BASE = "https://api.stripe.com/v1";
// Tolerance for timestamp drift (seconds). Stripe recommends 5 min.
const SIGNATURE_TOLERANCE_SECONDS = 300;

export function createStripeProvider({ secretKey }) {
  if (!secretKey) throw new Error("stripe billing provider: secret_key missing");

  const authHeader = "Basic " + Buffer.from(`${secretKey}:`).toString("base64");

  // Form-encode a flat-or-nested object the way Stripe expects.
  // Stripe uses bracket notation for nested keys, e.g.:
  //   line_items[0][price]=price_123&line_items[0][quantity]=1
  function encode(obj, prefix = "") {
    const parts = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue;
      const key = prefix ? `${prefix}[${k}]` : k;
      if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (item && typeof item === "object") {
            parts.push(encode(item, `${key}[${i}]`));
          } else {
            parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
          }
        });
      } else if (typeof v === "object") {
        parts.push(encode(v, key));
      } else {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
      }
    }
    return parts.filter(Boolean).join("&");
  }

  async function call(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encode(body),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`stripe: non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`stripe: ${msg}`);
    }
    return data;
  }

  return {
    name: NAME,

    async createCheckoutSession(input) {
      validateCheckoutInput(input);
      if (!input.priceId) {
        throw new Error(
          "createCheckoutSession: priceId required (paste the Stripe Price ID into Plan.stripePriceId)",
        );
      }
      const body = {
        mode: "subscription",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        // Bracket-style for line item array.
        line_items: [{ price: input.priceId, quantity: 1 }],
        // Metadata: we read tenantId + planSlug back from the webhook so
        // we know which DB row to update without trusting client input.
        metadata: {
          tenantId: input.tenantId,
          planSlug: input.planSlug,
        },
        subscription_data: {
          metadata: {
            tenantId: input.tenantId,
            planSlug: input.planSlug,
          },
        },
        // Stripe creates the Customer on the fly when we omit `customer`;
        // pass the existing customer id when known so the user's saved
        // payment methods + tax info carry over.
        ...(input.customerId ? { customer: input.customerId } : {}),
        ...(input.customerEmail && !input.customerId
          ? { customer_email: input.customerEmail }
          : {}),
      };
      const res = await call("/checkout/sessions", body);
      return { url: res.url, sessionId: res.id };
    },

    async createPortalSession(input) {
      validatePortalInput(input);
      const res = await call("/billing_portal/sessions", {
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: res.url };
    },

    verifyWebhookSignature({ rawBody, headers, secret }) {
      if (!rawBody || !secret) return false;
      const sigHeader = headers["stripe-signature"] || headers["Stripe-Signature"];
      if (!sigHeader) return false;

      // Format: "t=<ts>,v1=<sig1>,v1=<sig2>,..."
      const parts = String(sigHeader).split(",").reduce((acc, p) => {
        const [k, v] = p.split("=");
        if (!acc[k]) acc[k] = [];
        acc[k].push(v);
        return acc;
      }, {});
      const ts = parts.t?.[0];
      const sigs = parts.v1 || [];
      if (!ts || sigs.length === 0) return false;

      // Reject stale signatures.
      const tsNum = Number(ts);
      if (!Number.isFinite(tsNum)) return false;
      const ageSeconds = Math.floor(Date.now() / 1000) - tsNum;
      if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) return false;

      // Compute expected signature: HMAC-SHA256 of "${t}.${rawBody}".
      const payload = `${ts}.${rawBody.toString("utf8")}`;
      const expected = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");

      // Constant-time comparison against each accepted v1.
      for (const sig of sigs) {
        if (sig.length !== expected.length) continue;
        try {
          if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return true;
        } catch {
          // Length mismatch on buffer — already filtered above; defensive.
        }
      }
      return false;
    },

    parseWebhookEvent({ rawBody }) {
      const event = JSON.parse(rawBody.toString("utf8"));
      return {
        id: event.id,
        type: event.type,
        livemode: event.livemode,
        data: event.data,
        raw: event,
      };
    },

    async healthCheck() {
      try {
        const res = await fetch(`${API_BASE}/customers?limit=1`, {
          headers: { Authorization: authHeader },
        });
        if (res.status === 401) {
          return { provider: NAME, ok: false, error: "auth failed (401)" };
        }
        return { provider: NAME, ok: res.ok };
      } catch (err) {
        return { provider: NAME, ok: false, error: err.message };
      }
    },
  };
}
