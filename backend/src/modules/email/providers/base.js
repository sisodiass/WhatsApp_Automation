// Email provider contract. Mirrors the AI / payments provider pattern:
// vendor SDKs (or vendor HTTPS calls) live ONLY inside `*.provider.js`.
// Feature code talks to the factory, never the vendor.
//
// Every provider exports an object with:
//
//   name        — short id stamped on logs + settings (resend|postmark|stub)
//   send({ to, from, subject, html, text }) -> { messageId, provider }
//   healthCheck() -> { provider, ok, error? }
//
// Multi-recipient is intentionally NOT a first-class operation in v1.
// All transactional traffic in this codebase is 1:1 (alerts, password
// reset, etc.). Bulk customer email isn't a use case today; if it
// becomes one, add it as a new method rather than overloading `send`.
//
// Templates: the caller hands us pre-rendered HTML + plain-text. Layout
// + branding lives in email.service.js's renderTemplate(), NOT in
// provider code, so swapping providers doesn't change the email's look.

export const REQUIRED_FIELDS = ["to", "from", "subject"];

export function validateSendInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("send: input must be an object");
  }
  for (const f of REQUIRED_FIELDS) {
    if (!input[f] || typeof input[f] !== "string") {
      throw new Error(`send: missing required field "${f}"`);
    }
  }
  if (!input.html && !input.text) {
    throw new Error("send: at least one of html/text is required");
  }
}
