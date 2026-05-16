// Decides whether a given in-app notification should ALSO be emailed.
// Operators control this via two settings:
//
//   email.enabled       — master switch (default true). If false,
//                         maybeEmailNotification is a no-op.
//   email.notify_kinds  — CSV of notification.kind values that should
//                         trigger an email. Default:
//                         "JOB_FAILED,WEBHOOK_FAILED,AI_QUOTATION_REVIEW".
//                         Routine notifications (LEAD_ASSIGNED,
//                         FOLLOWUP_SENT) stay in-app to avoid inbox
//                         spam.
//
// Best-effort: all errors are swallowed. Email failure must never
// cascade and crash a worker or webhook handler.

import { child } from "../../shared/logger.js";
import { prisma } from "../../shared/prisma.js";
import { decrypt } from "../../utils/crypto.js";
import { emailNotification } from "./email.service.js";

const log = child("email-dispatcher");

const DEFAULT_KINDS = ["JOB_FAILED", "WEBHOOK_FAILED", "AI_QUOTATION_REVIEW"];

async function readSettings(tenantId) {
  const rows = await prisma.setting.findMany({
    where: {
      tenantId,
      key: { in: ["email.enabled", "email.notify_kinds"] },
    },
  });
  const out = {};
  for (const r of rows) out[r.key] = r.encrypted ? safeDecrypt(r.value) : r.value;
  return out;
}

function safeDecrypt(v) {
  try {
    return decrypt(v);
  } catch {
    return null;
  }
}

function parseKinds(raw) {
  if (typeof raw !== "string" || !raw.trim()) return DEFAULT_KINDS;
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

// Main entry point. Call AFTER createNotification (or the createMany
// equivalent for fan-outs). The function looks up each user's email
// address itself — caller doesn't need to provide it.
//
// Inputs:
//   tenantId   — required
//   userIds    — recipients (admins / lead owner / etc.)
//   kind       — notification kind string
//   title      — same as the in-app notification title
//   body       — optional
//   url        — optional deep link (frontend route, prepended with
//                FRONTEND_URL in the rendered email)
export async function maybeEmailNotification({ tenantId, userIds, kind, title, body, url }) {
  if (!tenantId || !Array.isArray(userIds) || userIds.length === 0) return;
  try {
    const cfg = await readSettings(tenantId);
    if (cfg["email.enabled"] === false) return; // explicitly disabled

    const allowedKinds = parseKinds(cfg["email.notify_kinds"]);
    if (!allowedKinds.includes(String(kind).toUpperCase())) return;

    const users = await prisma.user.findMany({
      // email is required on User (non-nullable) so we don't need to
      // filter it; just enforce active + id-in-set.
      where: { id: { in: userIds }, isActive: true },
      select: { id: true, email: true },
    });
    if (users.length === 0) return;

    const fullUrl = absolutize(url);
    // Sequential rather than Promise.all — one stuck SMTP shouldn't
    // hold up the rest of the batch; failures don't propagate.
    for (const u of users) {
      try {
        await emailNotification({
          to: u.email,
          title,
          body,
          url: fullUrl,
          kind,
        });
      } catch (err) {
        log.warn("email send failed (continuing)", {
          userId: u.id,
          kind,
          err: err?.message,
        });
      }
    }
  } catch (err) {
    log.warn("maybeEmailNotification swallowed error", { err: err?.message });
  }
}

// Turn a relative URL (/leads/abc) into an absolute one using the
// FRONTEND_URL env. Pass-through for already-absolute URLs.
function absolutize(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
  if (!base) return url;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}
