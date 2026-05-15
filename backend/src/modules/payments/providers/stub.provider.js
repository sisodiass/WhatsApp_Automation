// PAYMENTS_STUB provider — deterministic local provider for dev + tests.
// Mirrors the AI_STUB pattern in ai/providers. Returns predictable IDs;
// webhooks are simulated via POST /api/dev/payments/simulate-webhook
// when PAYMENTS_STUB=true.

import crypto from "node:crypto";
import { Kinds } from "./base.js";

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function createStubProvider() {
  return {
    name: "stub",
    async createPaymentLink({ amount, currency, redirectUrl, expiresAt, metadata }) {
      const providerLinkId = id("stub_link");
      return {
        providerLinkId,
        shortUrl: `${redirectUrl || "http://localhost:5173"}/dev/pay/${providerLinkId}`,
        status: "CREATED",
        raw: { amount, currency, expiresAt, metadata },
      };
    },
    async getPaymentStatus(_providerLinkId) {
      return { status: "PENDING", transactions: [] };
    },
    verifyWebhookSignature() {
      // Stub mode accepts any signature so dev simulations don't need keys.
      return true;
    },
    parseWebhookEvent({ rawBody }) {
      // The simulate-webhook dev route POSTs JSON of the shape we expect.
      let parsed;
      try {
        parsed = typeof rawBody === "string"
          ? JSON.parse(rawBody)
          : Buffer.isBuffer(rawBody)
          ? JSON.parse(rawBody.toString("utf8"))
          : rawBody;
      } catch {
        return { kind: Kinds.UNKNOWN, raw: rawBody };
      }
      return {
        kind: parsed.kind || Kinds.PAYMENT_CAPTURED,
        providerLinkId: parsed.providerLinkId || null,
        providerPaymentId: parsed.providerPaymentId || id("stub_pay"),
        providerOrderId: parsed.providerOrderId || null,
        amount: parsed.amount ?? null,
        currency: parsed.currency || null,
        status: parsed.status || "CAPTURED",
        capturedAt: parsed.capturedAt ? new Date(parsed.capturedAt) : new Date(),
        method: parsed.method || "stub",
        raw: parsed,
      };
    },
    async refund({ providerPaymentId, amount }) {
      return {
        refundId: id("stub_refund"),
        status: "REFUNDED",
        raw: { providerPaymentId, amount },
      };
    },
  };
}
