// Integration tests for the M11.C1 password-reset + email-verify flows.
// Uses EMAIL_STUB so no real provider is hit; the stub records sends in
// an inspectable array. Each test builds a throwaway user and cleans up.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
dotenv.config();
process.env.EMAIL_STUB = "true";

import { PrismaClient } from "@prisma/client";
import { getDefaultTenantId } from "../../src/shared/tenant.js";
import {
  createToken,
  consumeToken,
} from "../../src/modules/auth/auth.tokens.js";
import {
  clearStubSentEmails,
  getStubSentEmails,
} from "../../src/modules/email/providers/index.js";

const p = new PrismaClient();
let tid;

before(async () => {
  tid = await getDefaultTenantId();
});
after(async () => {
  await p.$disconnect();
});
beforeEach(() => {
  clearStubSentEmails();
});

async function makeUser() {
  const email = `c1-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@local.test`;
  const passwordHash = await bcrypt.hash("initial-password", 12);
  return p.user.create({
    data: { tenantId: tid, email, passwordHash, name: "C1 Test", role: "AGENT", isActive: true },
  });
}

async function cleanup(userId) {
  await p.authToken.deleteMany({ where: { userId } });
  await p.user.delete({ where: { id: userId } });
}

describe("createToken + consumeToken — happy path", () => {
  test("create returns plaintext, consume returns the user, idempotent on second consume", async () => {
    const user = await makeUser();
    try {
      const plaintext = await createToken({ userId: user.id, kind: "RESET_PASSWORD" });
      assert.ok(typeof plaintext === "string");
      assert.ok(plaintext.length >= 40, "32-byte token base64url'd should be long");

      const consumedUser = await consumeToken(plaintext, "RESET_PASSWORD");
      assert.equal(consumedUser.id, user.id);

      // Second consumption must fail (single-use).
      await assert.rejects(
        () => consumeToken(plaintext, "RESET_PASSWORD"),
        /invalid or expired/,
      );
    } finally {
      await cleanup(user.id);
    }
  });

  test("wrong kind rejected — RESET_PASSWORD token can't be used as VERIFY_EMAIL", async () => {
    const user = await makeUser();
    try {
      const plaintext = await createToken({ userId: user.id, kind: "RESET_PASSWORD" });
      await assert.rejects(
        () => consumeToken(plaintext, "VERIFY_EMAIL"),
        /invalid or expired/,
      );
    } finally {
      await cleanup(user.id);
    }
  });

  test("expired token rejected", async () => {
    const user = await makeUser();
    try {
      // Issue a 50ms-TTL token so we can wait it out without slowing tests.
      const plaintext = await createToken({
        userId: user.id,
        kind: "RESET_PASSWORD",
        ttlMs: 50,
      });
      await new Promise((r) => setTimeout(r, 80));
      await assert.rejects(
        () => consumeToken(plaintext, "RESET_PASSWORD"),
        /invalid or expired/,
      );
    } finally {
      await cleanup(user.id);
    }
  });

  test("invalidatePrior=true marks earlier unused tokens as used", async () => {
    const user = await makeUser();
    try {
      const a = await createToken({ userId: user.id, kind: "RESET_PASSWORD" });
      const b = await createToken({
        userId: user.id,
        kind: "RESET_PASSWORD",
        invalidatePrior: true,
      });
      // a must be invalidated.
      await assert.rejects(
        () => consumeToken(a, "RESET_PASSWORD"),
        /invalid or expired/,
      );
      // b still works.
      await consumeToken(b, "RESET_PASSWORD");
    } finally {
      await cleanup(user.id);
    }
  });

  test("invalidatePrior=true is kind-scoped — VERIFY_EMAIL tokens for the same user stay valid", async () => {
    const user = await makeUser();
    try {
      const v = await createToken({ userId: user.id, kind: "VERIFY_EMAIL" });
      const r1 = await createToken({ userId: user.id, kind: "RESET_PASSWORD" });
      const r2 = await createToken({
        userId: user.id,
        kind: "RESET_PASSWORD",
        invalidatePrior: true,
      });
      // VERIFY token still works.
      await consumeToken(v, "VERIFY_EMAIL");
      // r1 invalidated.
      await assert.rejects(() => consumeToken(r1, "RESET_PASSWORD"), /invalid or expired/);
      // r2 still works.
      await consumeToken(r2, "RESET_PASSWORD");
    } finally {
      await cleanup(user.id);
    }
  });
});

describe("createToken — at-rest hashing — DB stores hash, not plaintext", () => {
  test("the DB row's token_hash never equals the plaintext", async () => {
    const user = await makeUser();
    try {
      const plaintext = await createToken({ userId: user.id, kind: "RESET_PASSWORD" });
      const row = await p.authToken.findFirst({ where: { userId: user.id, kind: "RESET_PASSWORD" } });
      assert.ok(row);
      assert.notEqual(row.tokenHash, plaintext);
      // The hash should be 64-char hex (SHA-256).
      assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
    } finally {
      await cleanup(user.id);
    }
  });
});

describe("forgot-password flow (controller-level, via importing it as a function)", () => {
  // Drive the controller directly without HTTP so we don't depend on
  // booting Express. Mocks just enough of req/res to capture status+body.
  test("emits an email + invalidates prior tokens, but always returns ok", async () => {
    const { forgotPassword } = await import("../../src/modules/auth/auth.controller.js");
    const user = await makeUser();
    try {
      // First call — issues a reset email.
      const res1 = await invoke(forgotPassword, { email: user.email });
      assert.deepEqual(res1.jsonBody, { ok: true });
      const sent1 = getStubSentEmails();
      assert.equal(sent1.length, 1);
      assert.equal(sent1[0].to, user.email);
      assert.match(sent1[0].subject, /reset/i);
      assert.match(sent1[0].html, /Reset password/);

      clearStubSentEmails();

      // Second call — should invalidate the first token + send a new email.
      const res2 = await invoke(forgotPassword, { email: user.email });
      assert.equal(res2.statusCode, 200);
      assert.equal(getStubSentEmails().length, 1);

      // Two AuthToken rows; first one marked used.
      const rows = await p.authToken.findMany({
        where: { userId: user.id, kind: "RESET_PASSWORD" },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(rows.length, 2);
      assert.ok(rows[0].usedAt !== null, "first token must be invalidated");
      assert.ok(rows[1].usedAt === null, "second token must still be active");
    } finally {
      await cleanup(user.id);
    }
  });

  test("unknown email — silent 200, no email sent (account enumeration protection)", async () => {
    const { forgotPassword } = await import("../../src/modules/auth/auth.controller.js");
    const res = await invoke(forgotPassword, {
      email: `nonexistent-${Date.now()}@local.test`,
    });
    assert.deepEqual(res.jsonBody, { ok: true });
    assert.equal(getStubSentEmails().length, 0);
  });
});

describe("verify-email flow", () => {
  test("verifyEmail sets emailVerifiedAt and consumes the token", async () => {
    const { verifyEmail, resendVerification } = await import(
      "../../src/modules/auth/auth.controller.js"
    );
    const user = await makeUser();
    try {
      // Request a verification email first.
      const resendRes = await invoke(resendVerification, { email: user.email });
      assert.deepEqual(resendRes.jsonBody, { ok: true });
      const sent = getStubSentEmails();
      assert.equal(sent.length, 1);
      // Pull the token out of the URL embedded in the email HTML.
      const match = sent[0].html.match(/token=([A-Za-z0-9_-]+)/);
      assert.ok(match, "verification email should contain a token in its URL");
      const token = match[1];

      // Consume the token.
      const verifyRes = await invoke(verifyEmail, { token });
      assert.equal(verifyRes.jsonBody.ok, true);

      const refreshed = await p.user.findUnique({ where: { id: user.id } });
      assert.ok(refreshed.emailVerifiedAt, "emailVerifiedAt should now be set");
    } finally {
      await cleanup(user.id);
    }
  });

  test("already-verified user — resend is a no-op (no email sent)", async () => {
    const { resendVerification } = await import("../../src/modules/auth/auth.controller.js");
    const user = await makeUser();
    try {
      await p.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
      const res = await invoke(resendVerification, { email: user.email });
      assert.deepEqual(res.jsonBody, { ok: true });
      assert.equal(getStubSentEmails().length, 0);
    } finally {
      await cleanup(user.id);
    }
  });
});

// ─── Controller-driving harness ───────────────────────────────────
// asyncHandler returns IMMEDIATELY (it just .catch'es the underlying
// promise), so a plain `await controllerFn(req, res)` from the test
// doesn't actually wait for res.json. invoke() does: it builds a res
// whose .json (or next-call) resolves an outer promise the caller
// awaits.
function mockReq(body) {
  return { body };
}
async function invoke(controller, body) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      jsonBody: null,
      status(code) {
        res.statusCode = code;
        return res;
      },
      json(body) {
        res.jsonBody = body;
        resolve(res);
        return res;
      },
    };
    const next = (err) => (err ? reject(err) : resolve(res));
    controller(mockReq(body), res, next);
  });
}
