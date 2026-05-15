// Provider interface contract. Each provider exports a function returning
// an object that implements all of these methods.
//
//   createPaymentLink({ amount, currency, customer, metadata,
//                       redirectUrl, expiresAt }) →
//     { providerLinkId, shortUrl, status, raw }
//   getPaymentStatus(providerLinkId) →
//     { status, transactions: [{ providerPaymentId, status, amount, ... }] }
//   verifyWebhookSignature({ rawBody, headers, secret }) → boolean
//   parseWebhookEvent({ rawBody, headers }) →
//     { kind, providerLinkId?, providerPaymentId?, amount?, status?,
//       capturedAt?, raw }
//   refund({ providerPaymentId, amount, reason }) →
//     { refundId, status, raw }
//
// `kind` values: "link.paid" | "link.expired" | "link.cancelled" |
//                "payment.captured" | "payment.failed" | "refund.processed"
//                | "unknown"
//
// Providers never reach into the DB. The service does that.

export const Kinds = Object.freeze({
  LINK_PAID: "link.paid",
  LINK_EXPIRED: "link.expired",
  LINK_CANCELLED: "link.cancelled",
  PAYMENT_CAPTURED: "payment.captured",
  PAYMENT_FAILED: "payment.failed",
  REFUND_PROCESSED: "refund.processed",
  UNKNOWN: "unknown",
});
