// Email provider factory. Same shape as ai/providers/index.js +
// payments/providers/index.js:
//   - Reads `email.provider` + per-provider creds from the Setting table.
//   - Decrypts encrypted keys via the standard `decrypt()` helper.
//   - Caches one provider instance per (provider, key fingerprint).
//   - settings.service calls invalidateEmailProvider() on email.* writes
//     so the next caller picks up new creds without a process restart.
//
// EMAIL_STUB=true forces the stub provider regardless of settings — used
// by dev + CI. The stub records every send in an in-memory array that
// tests can inspect via getStubSentEmails() / clearStubSentEmails().

import crypto from "node:crypto";
import { child } from "../../../shared/logger.js";
import { getDefaultTenantId } from "../../../shared/tenant.js";
import { prisma } from "../../../shared/prisma.js";
import { decrypt } from "../../../utils/crypto.js";
import { validateSendInput } from "./base.js";
import { createResendProvider } from "./resend.provider.js";
import { createPostmarkProvider } from "./postmark.provider.js";

const log = child("email-provider");

// Stub provider — deterministic, in-memory. Lets unit/integration tests
// assert "email was sent with this subject/body" without hitting a real
// API. Also the safe default when no creds are configured.
const _stubSent = [];
function createStubProvider() {
  return {
    name: "stub",
    async send(input) {
      validateSendInput(input);
      const entry = {
        ...input,
        messageId: `stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sentAt: new Date().toISOString(),
      };
      _stubSent.push(entry);
      log.info("[stub] email send", { to: input.to, subject: input.subject });
      return { messageId: entry.messageId, provider: "stub" };
    },
    async healthCheck() {
      return { provider: "stub", ok: true };
    },
  };
}

export function getStubSentEmails() {
  return [..._stubSent];
}

export function clearStubSentEmails() {
  _stubSent.length = 0;
}

const SETTING_KEYS = [
  "email.provider",
  "email.from_address",
  "email.from_name",
  "email.resend.api_key",
  "email.postmark.server_token",
];

async function readSettings(tenantId, keys) {
  const rows = await prisma.setting.findMany({
    where: { tenantId, key: { in: keys } },
  });
  const out = {};
  for (const r of rows) {
    if (r.encrypted) {
      try {
        out[r.key] = decrypt(r.value);
      } catch {
        // skip — corrupted / wrong key
      }
    } else {
      out[r.key] = r.value;
    }
  }
  return out;
}

const REGISTRY = {
  resend: ({ apiKey }) => createResendProvider({ apiKey }),
  postmark: ({ serverToken }) => createPostmarkProvider({ serverToken }),
  stub: () => createStubProvider(),
};

let cached = null; // { signature, provider, fromAddress, fromName }

function fingerprint(s) {
  if (!s) return "none";
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
}

export async function getEmailProvider() {
  if (process.env.EMAIL_STUB === "true") {
    if (cached?.signature === "stub-forced") return cached;
    const stub = REGISTRY.stub();
    cached = {
      signature: "stub-forced",
      provider: stub,
      fromAddress: "stub@local.test",
      fromName: "Stub",
      fromHeader: formatFrom("Stub", "stub@local.test"),
    };
    return cached;
  }

  const tenantId = await getDefaultTenantId();
  const cfg = await readSettings(tenantId, SETTING_KEYS);
  const name = String(cfg["email.provider"] || "stub").toLowerCase();
  if (!REGISTRY[name]) throw new Error(`unknown email provider "${name}"`);

  const fromAddress = cfg["email.from_address"] || "noreply@local.test";
  const fromName = cfg["email.from_name"] || "SalesAutomation";
  // Build the From header line lazily — providers want a single string.
  // RFC-5322 quoted-string for the display name if needed.
  const fromHeader = formatFrom(fromName, fromAddress);

  let creds = {};
  let credSource = "settings";
  if (name === "resend") {
    creds.apiKey = cfg["email.resend.api_key"] || "";
    if (!creds.apiKey) throw new Error("email.resend.api_key not configured");
  } else if (name === "postmark") {
    creds.serverToken = cfg["email.postmark.server_token"] || "";
    if (!creds.serverToken) throw new Error("email.postmark.server_token not configured");
  } else if (name === "stub") {
    credSource = "stub";
  }

  const sig = `${name}|${fromHeader}|${fingerprint(creds.apiKey || creds.serverToken || "")}`;
  if (cached?.signature === sig) return cached;

  log.info("instantiating email provider", { name, fromAddress, credSource });
  const provider = REGISTRY[name](creds);
  cached = { signature: sig, provider, fromAddress, fromName, fromHeader };
  return cached;
}

export function invalidateEmailProvider() {
  cached = null;
}

export function listEmailProviders() {
  return Object.keys(REGISTRY);
}

function formatFrom(name, address) {
  if (!name) return address;
  // If name contains characters that need quoting, wrap in quotes.
  const needsQuotes = /[",;<>()]/.test(name);
  const safeName = needsQuotes ? `"${name.replace(/"/g, '\\"')}"` : name;
  return `${safeName} <${address}>`;
}
