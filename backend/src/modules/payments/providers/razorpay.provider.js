// Razorpay payment-link provider. Native HTTPS (no SDK import in feature
// code per memory rule; this provider file is the ONLY place the API is
// touched). Auth via HTTP Basic with (key_id : key_secret).
//
// Docs:
//   Payment Links: POST https://api.razorpay.com/v1/payment_links
//   Get link:      GET  https://api.razorpay.com/v1/payment_links/:id
//   Webhook sig:   X-Razorpay-Signature = HMAC_SHA256(body, webhook_secret)
//
// Razorpay amounts are integer minor units (paise for INR, cents for USD).

import crypto from "node:crypto";
import { Kinds } from "./base.js";

const BASE = "https://api.razorpay.com/v1";

function basicAuth(keyId, keySecret) {
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

function toMinor(amount, currency) {
  // Razorpay treats most currencies as minor units (paise/cents). A handful
  // are major-only (JPY, KRW, VND); we cover the common case here.
  const noMinor = new Set(["JPY", "KRW", "VND", "CLP"]);
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new Error("invalid amount");
  if (noMinor.has(currency)) return Math.round(n);
  return Math.round(n * 100);
}

function fromMinor(amount, currency) {
  const noMinor = new Set(["JPY", "KRW", "VND", "CLP"]);
  return noMinor.has(currency) ? Number(amount) : Number(amount) / 100;
}

async function callRazorpay(path, { method = "GET", auth, body }) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const msg = data?.error?.description || `HTTP ${r.status}`;
    const err = new Error(`razorpay: ${msg}`);
    err.status = r.status;
    err.raw = data;
    throw err;
  }
  return data;
}

export function createRazorpayProvider({ keyId, keySecret }) {
  if (!keyId || !keySecret) {
    throw new Error("razorpay keyId + keySecret required");
  }
  const auth = basicAuth(keyId, keySecret);

  return {
    name: "razorpay",
    async createPaymentLink({
      amount,
      currency,
      customer,
      metadata,
      redirectUrl,
      expiresAt,
    }) {
      const body = {
        amount: toMinor(amount, currency),
        currency,
        accept_partial: false,
        reference_id: metadata?.referenceId,
        description: metadata?.description || "Payment",
        customer: customer
          ? {
              name: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || undefined,
              contact: customer.mobile,
              email: customer.email || undefined,
            }
          : undefined,
        notify: { sms: !!customer?.mobile, email: !!customer?.email },
        reminder_enable: true,
        notes: metadata?.notes || {},
        callback_url: redirectUrl,
        callback_method: "get",
        ...(expiresAt
          ? { expire_by: Math.floor(new Date(expiresAt).getTime() / 1000) }
          : {}),
      };
      const data = await callRazorpay("/payment_links", { method: "POST", auth, body });
      return {
        providerLinkId: data.id,
        shortUrl: data.short_url,
        status: "CREATED",
        raw: data,
      };
    },

    async getPaymentStatus(providerLinkId) {
      const data = await callRazorpay(`/payment_links/${providerLinkId}`, { auth });
      const txns = (data.payments || []).map((p) => ({
        providerPaymentId: p.payment_id || p.id,
        status: (p.status || "").toUpperCase(),
        amount: fromMinor(p.amount, data.currency),
        currency: data.currency,
      }));
      return { status: (data.status || "").toUpperCase(), transactions: txns };
    },

    verifyWebhookSignature({ rawBody, headers, secret }) {
      const sig = headers["x-razorpay-signature"] || headers["X-Razorpay-Signature"];
      if (!sig || !secret) return false;
      const expected = crypto
        .createHmac("sha256", secret)
        .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody)))
        .digest("hex");
      try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      } catch {
        return false;
      }
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
      const event = body?.event;
      const pl = body?.payload || {};
      const link = pl?.payment_link?.entity;
      const payment = pl?.payment?.entity;
      const refund = pl?.refund?.entity;

      let kind = Kinds.UNKNOWN;
      switch (event) {
        case "payment_link.paid":
          kind = Kinds.LINK_PAID;
          break;
        case "payment_link.expired":
          kind = Kinds.LINK_EXPIRED;
          break;
        case "payment_link.cancelled":
          kind = Kinds.LINK_CANCELLED;
          break;
        case "payment.captured":
          kind = Kinds.PAYMENT_CAPTURED;
          break;
        case "payment.failed":
          kind = Kinds.PAYMENT_FAILED;
          break;
        case "refund.processed":
          kind = Kinds.REFUND_PROCESSED;
          break;
        default:
          kind = Kinds.UNKNOWN;
      }

      const currency = link?.currency || payment?.currency || refund?.currency;
      const amountMinor = link?.amount ?? payment?.amount ?? refund?.amount;
      const amount =
        amountMinor != null && currency ? fromMinor(amountMinor, currency) : null;

      return {
        kind,
        providerLinkId: link?.id || payment?.notes?.link_id || null,
        providerPaymentId: payment?.id || refund?.payment_id || null,
        providerOrderId: payment?.order_id || null,
        amount,
        currency: currency || null,
        status: (payment?.status || link?.status || "").toUpperCase(),
        capturedAt: payment?.captured_at
          ? new Date(payment.captured_at * 1000)
          : new Date(),
        method: payment?.method || null,
        raw: body,
      };
    },

    async refund({ providerPaymentId, amount, reason }) {
      const body = amount ? { amount: toMinor(amount, "INR"), notes: { reason } } : {};
      const data = await callRazorpay(`/payments/${providerPaymentId}/refund`, {
        method: "POST",
        auth,
        body,
      });
      return { refundId: data.id, status: (data.status || "").toUpperCase(), raw: data };
    },
  };
}
