// Unit tests for the M11.C1 auth-token primitives. Pure functions only —
// the DB-backed create/consume helpers have their own integration test.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { _hashToken, DEFAULT_TTLS } from "../../src/modules/auth/auth.tokens.js";

describe("_hashToken — at-rest hashing", () => {
  test("returns a 64-char hex SHA-256 digest", () => {
    const h = _hashToken("hello");
    assert.match(h, /^[0-9a-f]{64}$/);
    // Spot-check against a known SHA-256.
    assert.equal(h, crypto.createHash("sha256").update("hello").digest("hex"));
  });

  test("deterministic — same input → same output", () => {
    const a = _hashToken("a-particular-token");
    const b = _hashToken("a-particular-token");
    assert.equal(a, b);
  });

  test("different inputs → different outputs", () => {
    assert.notEqual(_hashToken("abc"), _hashToken("xyz"));
  });

  test("doesn't preserve the plaintext (one-way)", () => {
    const plain = "supersecret-reset-token-9b4c3";
    const h = _hashToken(plain);
    assert.ok(!h.includes(plain));
    assert.ok(!h.includes("supersecret"));
  });
});

describe("DEFAULT_TTLS — sensible defaults per kind", () => {
  test("reset is short (~1 hour) — short window limits damage if email leaks", () => {
    assert.equal(DEFAULT_TTLS.RESET_PASSWORD, 60 * 60 * 1000);
  });

  test("verify is longer (~24 hours) — email may sit in inbox", () => {
    assert.equal(DEFAULT_TTLS.VERIFY_EMAIL, 24 * 60 * 60 * 1000);
  });

  test("only the two whitelisted kinds are defined", () => {
    assert.deepEqual(Object.keys(DEFAULT_TTLS).sort(), [
      "RESET_PASSWORD",
      "VERIFY_EMAIL",
    ]);
  });
});
