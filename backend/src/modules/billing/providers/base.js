// Billing provider contract. Mirrors AI / payments / email factories:
// vendor APIs live only inside provider files; feature code talks to
// the factory.
//
// Methods every provider must export:
//
//   name                                  short id (logs + settings)
//   createCheckoutSession(input)          → { url, sessionId }
//   createPortalSession(input)            → { url }
//   verifyWebhookSignature(input)         → boolean
//   parseWebhookEvent(input)              → { id, type, data, ... }
//   healthCheck()                         → { provider, ok, error? }
//
// All amounts are in cents. Currencies are ISO 4217.

export function validateCheckoutInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("createCheckoutSession: input required");
  }
  if (!input.planSlug) throw new Error("createCheckoutSession: planSlug required");
  if (!input.successUrl) throw new Error("createCheckoutSession: successUrl required");
  if (!input.cancelUrl) throw new Error("createCheckoutSession: cancelUrl required");
}

export function validatePortalInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("createPortalSession: input required");
  }
  if (!input.customerId) throw new Error("createPortalSession: customerId required");
  if (!input.returnUrl) throw new Error("createPortalSession: returnUrl required");
}
