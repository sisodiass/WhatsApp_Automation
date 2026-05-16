// Postmark transactional email provider. Native fetch — no SDK dep.
// Postmark API: https://postmarkapp.com/developer/api/email-api
//   POST https://api.postmarkapp.com/email
//   X-Postmark-Server-Token: <token>
//   Body: { From, To, Subject, HtmlBody, TextBody, MessageStream }
//   Response: { MessageID, To, SubmittedAt, ErrorCode, Message }
//
// Postmark splits transactional vs broadcast streams; we always use the
// transactional default ("outbound") stream. Operators on Postmark
// should configure the from-address sender signature in their dashboard.

import { validateSendInput } from "./base.js";

const NAME = "postmark";
const API_URL = "https://api.postmarkapp.com/email";

export function createPostmarkProvider({ serverToken }) {
  if (!serverToken) throw new Error("postmark provider: server_token missing");

  async function call(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": serverToken,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`postmark: non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || (data.ErrorCode && data.ErrorCode !== 0)) {
      const msg = data?.Message || `HTTP ${res.status}`;
      throw new Error(`postmark: ${msg}`);
    }
    return data;
  }

  return {
    name: NAME,
    async send(input) {
      validateSendInput(input);
      const payload = {
        From: input.from,
        To: input.to,
        Subject: input.subject,
        HtmlBody: input.html || undefined,
        TextBody: input.text || undefined,
        MessageStream: "outbound",
      };
      const r = await call(payload);
      return { messageId: r.MessageID || null, provider: NAME };
    },
    async healthCheck() {
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: {
            "X-Postmark-Server-Token": serverToken,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: "{}",
        });
        if (res.status === 401 || res.status === 422) {
          // 422 = validation errors (e.g. missing From). 401 = bad token.
          // 422 means auth was accepted; 401 means it wasn't.
          if (res.status === 401) {
            return { provider: NAME, ok: false, error: "auth failed (401)" };
          }
        }
        return { provider: NAME, ok: true };
      } catch (err) {
        return { provider: NAME, ok: false, error: err.message };
      }
    },
  };
}
