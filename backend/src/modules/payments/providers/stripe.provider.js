// Stripe Payment Links provider. Native HTTPS only (no SDK in feature code).
// Auth via Bearer with the secret_key.
//
// Docs:
//   Payment Links: POST https://api.stripe.com/v1/payment_links  (requires
//                  a price; we create a Price + Product on the fly per link
//                  to keep state in our DB)
//   Webhook sig:   Stripe-Signature: t=<ts>,v1=<HMAC_SHA256(t.payload, secret)>
//
// Stripe amounts are integer minor units (cents). Currency is lowercase.

import crypto from "node:crypto";
import { Kinds } from "./base.js";

const BASE = "https://api.stripe.com/v1";

function toMinor(amount, currency) {
  const zero = new Set([
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW",
    "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
  ]);
  const cur = String(currency || "").toUpperCase();
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new Error("invalid amount");
  if (zero.has(cur)) return Math.round(n);
  return Math.round(n * 100);
}

function fromMinor(amount, currency) {
  const zero = new Set([
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW",
    "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
  ]);
  return zero.has(String(currency).toUpperCase()) ? Number(amount) : Number(amount) / 100;
}

function form(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) {
      out.push(form(v, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object") {
          out.push(form(item, `${key}[${i}]`));
        } else {
          out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out.join("&");
}

async function callStripe(path, { method = "GET", auth, body }) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? form(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const msg = data?.error?.message || `HTTP ${r.status}`;
    const err = new Error(`stripe: ${msg}`);
    err.status = r.status;
    err.raw = data;
    throw err;
  }
  return data;
}

export function createStripeProvider({ secretKey }) {
  if (!secretKey) throw new Error("stripe secretKey required");
  const auth = "Bearer " + secretKey;

  return {
    name: "stripe",
    async createPaymentLink({
      amount,
      currency,
      customer,
      metadata,
      redirectUrl,
      expiresAt: _expiresAt,
    }) {
      // 1. Create one-off Price (with inline product_data).
      const price = await callStripe("/prices", {
        method: "POST",
        auth,
        body: {
          unit_amount: toMinor(amount, currency),
          currency: String(currency || "").toLowerCase(),
          product_data: { name: metadata?.description || "Payment" },
        },
      });
      // 2. Create the Payment Link tied to that price.
      const link = await callStripe("/payment_links", {
        method: "POST",
        auth,
        body: {
          line_items: [{ price: price.id, quantity: 1 }],
          after_completion: redirectUrl
            ? { type: "redirect", redirect: { url: redirectUrl } }
            : undefined,
          metadata: {
            referenceId: metadata?.referenceId,
            ...(metadata?.notes || {}),
          },
        },
      });
      return {
        providerLinkId: link.id,
        shortUrl: link.url,
        status: "CREATED",
        raw: { price, link },
      };
    },

    async getPaymentStatus(providerLinkId) {
      const link = await callStripe(`/payment_links/${providerLinkId}`, { auth });
      return { status: link.active ? "PENDING" : "CANCELLED", transactions: [] };
    },

    verifyWebhookSignature({ rawBody, headers, secret }) {
      const sigHeader = headers["stripe-signature"] || headers["Stripe-Signature"];
      if (!sigHeader || !secret) return false;
      // Parse "t=<ts>,v1=<sig>" (commas separate fields, equals inside).
      const parts = String(sigHeader).split(",").map((p) => p.trim().split("="));
      const t = parts.find((p) => p[0] === "t")?.[1];
      const v1 = parts.find((p) => p[0] === "v1")?.[1];
      if (!t || !v1) return false;
      const payload = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
      const expected = crypto
        .createHmac("sha256", secret)
        .update(`${t}.${payload}`)
        .digest("hex");
      try {
        if (!crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) return false;
      } catch {
        return false;
      }
      // Tolerate 5-minute clock skew.
      const tsMs = Number(t) * 1000;
      return Math.abs(Date.now() - tsMs) < 5 * 60_000;
    },

    parseWebhookEvent({ rawBody }) {
      let body;
      try {
        body = JSON.parse(
          Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody),
        );
      } catch {
        return { kind: Kinds.UNKNOWN, raw: rawBody };
      }
      const type = body?.type;
      const obj = body?.data?.object || {};

      let kind = Kinds.UNKNOWN;
      switch (type) {
        case "checkout.session.completed":
        case "payment_intent.succeeded":
        case "charge.succeeded":
          kind = Kinds.PAYMENT_CAPTURED;
          break;
        case "payment_intent.payment_failed":
        case "charge.failed":
          kind = Kinds.PAYMENT_FAILED;
          break;
        case "charge.refunded":
        case "refund.created":
          kind = Kinds.REFUND_PROCESSED;
          break;
        case "payment_link.expired":
          kind = Kinds.LINK_EXPIRED;
          break;
        default:
          kind = Kinds.UNKNOWN;
      }

      const currency = (obj.currency || "").toUpperCase() || null;
      const amount = obj.amount_total ?? obj.amount ?? obj.amount_received ?? null;
      const linkId = obj.payment_link || obj.metadata?.payment_link_id || null;
      const paymentId = obj.payment_intent || obj.id || null;

      return {
        kind,
        providerLinkId: linkId,
        providerPaymentId: paymentId,
        providerOrderId: obj.id || null,
        amount: amount != null && currency ? fromMinor(amount, currency) : null,
        currency,
        status: (obj.status || "").toUpperCase(),
        capturedAt: new Date(),
        method: obj.payment_method_types?.[0] || null,
        raw: body,
      };
    },

    async refund({ providerPaymentId, amount, reason }) {
      const body = {
        payment_intent: providerPaymentId,
        ...(amount ? { amount: toMinor(amount, "USD") } : {}),
        ...(reason ? { reason: "requested_by_customer", metadata: { reason } } : {}),
      };
      const data = await callStripe("/refunds", { method: "POST", auth, body });
      return { refundId: data.id, status: (data.status || "").toUpperCase(), raw: data };
    },
  };
}
