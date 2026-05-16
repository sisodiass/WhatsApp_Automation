// Resend transactional email provider. Native fetch — no SDK dep.
// Resend API: https://resend.com/docs/api-reference/emails/send-email
//   POST https://api.resend.com/emails
//   Authorization: Bearer <api_key>
//   Body: { from, to, subject, html, text }
//   Response: { id }   // their messageId

import { validateSendInput } from "./base.js";

const NAME = "resend";
const API_URL = "https://api.resend.com/emails";

export function createResendProvider({ apiKey }) {
  if (!apiKey) throw new Error("resend provider: api_key missing");

  async function call(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`resend: non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      const msg = data?.message || data?.name || `HTTP ${res.status}`;
      throw new Error(`resend: ${msg}`);
    }
    return data;
  }

  return {
    name: NAME,
    async send(input) {
      validateSendInput(input);
      const payload = {
        from: input.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      };
      const r = await call(payload);
      return { messageId: r.id || null, provider: NAME };
    },
    async healthCheck() {
      // Resend has no "ping" endpoint. A trivial 400 on missing body is
      // a clean "auth works" probe — they return 401 for bad auth and
      // 400 for missing fields. Either way we hear from the API.
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: "{}",
        });
        // 401 = bad creds. 400 = creds OK, body invalid (which is fine).
        if (res.status === 401) {
          return { provider: NAME, ok: false, error: "auth failed (401)" };
        }
        return { provider: NAME, ok: true };
      } catch (err) {
        return { provider: NAME, ok: false, error: err.message };
      }
    },
  };
}
