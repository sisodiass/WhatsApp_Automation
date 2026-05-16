// M11.D3 — payment-webhook failure → in-app Notification.
//
// Mirrors job-failure-alerts.js but for the gateway-driven webhook
// path (which isn't a BullMQ job). Signature validation has already
// passed by the time we get here; the failure is an internal processing
// bug (DB down, FK violation, regression) that operators must see.
//
// Gateways (Razorpay, Stripe) retry 5xx on their own, so we re-throw
// after notifying. PaymentTransaction unique on
// (tenantId, provider, providerPaymentId) makes the retry idempotent.

import { prisma } from "./prisma.js";
import { child } from "./logger.js";

const log = child("payment-webhook-alerts");

const ALERT_ROLES = ["SUPER_ADMIN", "ADMIN"];

export async function emitWebhookFailureAlert({ tenantId, provider, event, err }) {
  try {
    if (!tenantId) return;

    const admins = await prisma.user.findMany({
      where: { tenantId, role: { in: ALERT_ROLES }, isActive: true },
      select: { id: true },
    });
    if (admins.length === 0) return;

    const eventType = event?.type || "unknown";
    const providerPaymentId =
      event?.providerPaymentId || event?.providerLinkId || "n/a";
    const title = `Payment webhook processing failed (${provider})`;
    const body = [
      err?.message ? err.message.slice(0, 400) : "Unknown error",
      `Provider: ${provider}`,
      `Event: ${eventType}`,
      `Payment ref: ${providerPaymentId}`,
      "Gateway will retry. Investigate logs if it persists.",
    ].join("\n");

    await prisma.notification.createMany({
      data: admins.map((u) => ({
        tenantId,
        userId: u.id,
        kind: "WEBHOOK_FAILED",
        title,
        body,
      })),
    });

    log.error("payment webhook failure notified", {
      provider,
      tenantId,
      eventType,
      providerPaymentId,
      recipients: admins.length,
      err: err?.message,
    });
  } catch (alertErr) {
    // Swallow — alerting must not mask the original failure. The
    // outer catch in the webhook handler re-throws the actual error.
    log.warn("failed to emit payment-webhook alert", {
      err: alertErr?.message,
    });
  }
}
