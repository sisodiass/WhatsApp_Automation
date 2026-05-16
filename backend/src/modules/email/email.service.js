// Transactional email service. Thin wrapper over the provider factory:
//   - sendEmail({ to, subject, html?, text?, kind? }) — basic send.
//   - emailNotification(notification, user) — same shape the in-app bell
//     uses, rendered through a single layout. Used by subscribers + the
//     job-failure / payment-webhook alerts to fan out the same payload
//     to email recipients.
//
// Layout: a deliberately tiny inline-styled template. No `mjml`, no
// `react-email` dep. Plays well across the mainstream clients (Gmail,
// Outlook web, Apple Mail) which strip <style>+ <link> tags anyway.

import { child } from "../../shared/logger.js";
import { getEmailProvider } from "./providers/index.js";

const log = child("email");

export async function sendEmail({ to, subject, html, text, kind = null }) {
  if (!to || !subject) throw new Error("sendEmail: 'to' and 'subject' are required");
  if (!html && !text) throw new Error("sendEmail: at least one of html/text is required");
  const { provider, fromHeader } = await getEmailProvider();
  const result = await provider.send({
    to,
    from: fromHeader,
    subject,
    html,
    text,
  });
  log.info("email sent", {
    to,
    subject: subject.slice(0, 80),
    kind,
    provider: result.provider,
    messageId: result.messageId,
  });
  return result;
}

// Renders the standard notification layout. Subject = notification.title.
// Body = optional `body` text + a call-to-action button if `url` is set.
// Keep this in sync with the in-app bell rendering so operators see
// the same content in both places.
export function renderNotificationEmail({ title, body, url, urlLabel = "Open" }) {
  const safeTitle = escapeHtml(title || "Notification");
  const safeBody = body ? escapeHtml(body).replace(/\n/g, "<br>") : "";
  const buttonHtml = url
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0 0 0;">
        <tr>
          <td bgcolor="#0f172a" style="border-radius: 6px; padding: 10px 18px;">
            <a href="${escapeAttr(url)}" target="_blank" style="color: #fff; font-family: -apple-system, Segoe UI, sans-serif; font-size: 14px; font-weight: 600; text-decoration: none;">
              ${escapeHtml(urlLabel)}
            </a>
          </td>
        </tr>
      </table>`
    : "";

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <title>${safeTitle}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, Segoe UI, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f8fafc;">
      <tr>
        <td align="center" style="padding: 40px 20px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width: 560px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
            <tr>
              <td style="padding: 32px 32px 8px 32px; color: #0f172a; font-size: 18px; font-weight: 600;">
                ${safeTitle}
              </td>
            </tr>
            ${
              safeBody
                ? `<tr>
                    <td style="padding: 0 32px 16px 32px; color: #475569; font-size: 14px; line-height: 1.55;">
                      ${safeBody}
                    </td>
                  </tr>`
                : ""
            }
            <tr>
              <td style="padding: 0 32px 32px 32px;">
                ${buttonHtml}
              </td>
            </tr>
            <tr>
              <td style="padding: 16px 32px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 11px;">
                Sent by SalesAutomation. You can mute these in Settings.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  // Plain-text fallback — many clients display this if HTML is blocked.
  const text = [
    title,
    body || "",
    url ? `${urlLabel}: ${url}` : "",
    "",
    "Sent by SalesAutomation.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { html, text };
}

export async function emailNotification({ to, title, body, url, kind }) {
  const { html, text } = renderNotificationEmail({ title, body, url });
  return sendEmail({ to, subject: title, html, text, kind });
}

// ─── HTML escaping (no jsdom dep) ─────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s) {
  return escapeHtml(s);
}
