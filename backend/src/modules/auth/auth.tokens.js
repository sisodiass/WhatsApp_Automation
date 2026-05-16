// M11.C1 — single-use auth tokens (verify email, reset password).
//
// Token discipline:
//   - Plaintext token: 32-byte cryptographic random, base64url-encoded.
//   - At-rest representation: SHA-256 of the plaintext. The plaintext is
//     embedded in the email link sent to the user and never persisted
//     anywhere else. A leaked DB dump cannot consume tokens.
//   - Single-use: `usedAt` set when consumed; second consumption fails.
//   - Expiry: enforced at consumption time. Default 1h for reset, 24h
//     for verify. Both configurable via the create() callers.
//   - Per-user invalidation: createToken({ invalidatePrior: true })
//     marks all prior unused tokens of the same kind as used. Used by
//     "resend verification" / "request another reset link" flows so
//     stale tokens stop working.
//
// Errors are intentionally generic ("invalid or expired token") so the
// API doesn't leak whether the token existed but expired vs never
// existed — sidesteps token-enumeration attacks.

import crypto from "node:crypto";
import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { BadRequest } from "../../shared/errors.js";

const log = child("auth-tokens");

// Defaults tuned to common UX: a reset link should be short-lived since
// it grants password change; verify links can sit in the inbox longer.
export const DEFAULT_TTLS = {
  RESET_PASSWORD: 60 * 60 * 1000, // 1 hour
  VERIFY_EMAIL: 24 * 60 * 60 * 1000, // 24 hours
};

function hashToken(plaintext) {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

function generatePlaintext() {
  // 32 bytes = 256 bits of entropy. base64url so the value is URL-safe
  // for embedding directly in the email link.
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Create a single-use auth token bound to a user.
 *
 * Returns the plaintext token. Caller is responsible for putting it in
 * a URL and emailing it. The DB only ever sees the hash.
 */
export async function createToken({
  userId,
  kind,
  ttlMs = DEFAULT_TTLS[kind],
  invalidatePrior = false,
}) {
  if (!userId || !kind) throw new Error("createToken: userId + kind required");
  if (!DEFAULT_TTLS[kind]) throw new Error(`createToken: unknown kind "${kind}"`);

  if (invalidatePrior) {
    await prisma.authToken.updateMany({
      where: { userId, kind, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  const plaintext = generatePlaintext();
  const tokenHash = hashToken(plaintext);
  const expiresAt = new Date(Date.now() + (ttlMs || DEFAULT_TTLS[kind]));
  await prisma.authToken.create({
    data: { userId, kind, tokenHash, expiresAt },
  });
  log.info("token issued", { userId, kind, expiresAt });
  return plaintext;
}

/**
 * Look up an unused, non-expired token by plaintext. Returns the row
 * including the joined user, or null if no match. Generic "invalid"
 * surface for callers — don't differentiate expired vs nonexistent.
 */
export async function findActiveToken(plaintext, kind) {
  if (!plaintext || !kind) return null;
  const tokenHash = hashToken(plaintext);
  const row = await prisma.authToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!row) return null;
  if (row.kind !== kind) return null;
  if (row.usedAt) return null;
  if (row.expiresAt <= new Date()) return null;
  return row;
}

/**
 * Atomically consume a token. Throws BadRequest if the token is invalid,
 * already used, expired, or wrong kind. Returns the user.
 *
 * Uses a transaction to close the race between two concurrent consumers:
 * the UPDATE only succeeds if usedAt is still null when it lands.
 */
export async function consumeToken(plaintext, kind) {
  const row = await findActiveToken(plaintext, kind);
  if (!row) throw BadRequest("invalid or expired token");

  // Best-effort race protection. The {usedAt: null} predicate makes the
  // UPDATE a no-op if someone else consumed in between findActive and
  // here; we detect via `count`.
  const result = await prisma.authToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (result.count === 0) throw BadRequest("invalid or expired token");
  log.info("token consumed", { userId: row.userId, kind });
  return row.user;
}

// Test helper — exposed so unit tests can verify the hash function
// directly without going through the DB.
export { hashToken as _hashToken };
