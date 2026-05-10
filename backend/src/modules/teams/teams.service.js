// Microsoft Graph Teams meeting creation via the OAuth client-credentials
// flow (app-only access). Activates only when all four settings are
// populated; otherwise we fall back to a stub that still records the
// booking but uses a placeholder join URL — the operator can replace it
// with a real meeting later, or wire the integration when creds arrive.
//
// Required app permissions on the registered Azure AD app:
//   - OnlineMeetings.ReadWrite.All  (Application)
// Required settings keys:
//   - microsoft.tenant_id
//   - microsoft.client_id
//   - microsoft.client_secret           (encrypted at rest)
//   - microsoft.organizer_user_id       (user GUID; the meeting "host")

import { child } from "../../shared/logger.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import { getSettings } from "../settings/settings.service.js";

const log = child("teams");

// Tiny in-process token cache. Tokens are valid ~60min; we re-fetch ~5min
// before expiry to absorb clock skew.
let tokenCache = null; // { token, expiresAt }

async function loadCreds() {
  const tenantId = await getDefaultTenantId();
  const cfg = await getSettings(tenantId, [
    "microsoft.tenant_id",
    "microsoft.client_id",
    "microsoft.client_secret",
    "microsoft.organizer_user_id",
  ]);
  return {
    tenantId: cfg["microsoft.tenant_id"] || null,
    clientId: cfg["microsoft.client_id"] || null,
    clientSecret: cfg["microsoft.client_secret"] || null,
    organizerUserId: cfg["microsoft.organizer_user_id"] || null,
  };
}

export async function isConfigured() {
  const c = await loadCreds();
  return Boolean(c.tenantId && c.clientId && c.clientSecret && c.organizerUserId);
}

async function getToken(creds) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
    return tokenCache.token;
  }
  const url = `https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`graph token error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return tokenCache.token;
}

/**
 * Creates a Teams online meeting and returns { id, joinUrl }.
 * If creds aren't configured, returns a stub booking the operator can
 * upgrade to a real one later.
 *
 * @param {object} args
 * @param {Date}   args.scheduledAt  — start time
 * @param {number} args.durationMinutes
 * @param {string} args.subject
 */
export async function createTeamsMeeting({ scheduledAt, durationMinutes, subject }) {
  const creds = await loadCreds();
  if (!creds.tenantId || !creds.clientId || !creds.clientSecret || !creds.organizerUserId) {
    log.warn("teams not configured — returning stub booking");
    return {
      stub: true,
      id: `stub-${Date.now()}`,
      joinUrl: null,
    };
  }

  const token = await getToken(creds);
  const start = new Date(scheduledAt);
  const end = new Date(start.getTime() + (durationMinutes || 30) * 60_000);

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
    creds.organizerUserId,
  )}/onlineMeetings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      subject: subject || "Demo",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`graph onlineMeetings error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    stub: false,
    id: data.id,
    joinUrl: data.joinWebUrl || data.joinUrl,
  };
}
