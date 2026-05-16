// Unit tests for the WhatsApp JID ↔ phone helpers + the @lid detector.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fromWaJid, toWaJid, isLidJid, normalizeMobile } from "../../src/utils/phone.js";

describe("fromWaJid", () => {
  test("strips @c.us from classic phone JIDs", () => {
    assert.equal(fromWaJid("919999999999@c.us"), "919999999999");
  });

  test("returns null for groups (@g.us)", () => {
    assert.equal(fromWaJid("123456789-987654321@g.us"), null);
  });

  test("preserves @lid intact — needed for outbound routing", () => {
    assert.equal(fromWaJid("167250388615354@lid"), "167250388615354@lid");
  });

  test("null / undefined / empty input → null", () => {
    assert.equal(fromWaJid(null), null);
    assert.equal(fromWaJid(undefined), null);
    assert.equal(fromWaJid(""), null);
  });
});

describe("toWaJid", () => {
  test("appends @c.us when input is bare digits", () => {
    assert.equal(toWaJid("919999999999"), "919999999999@c.us");
  });

  test("pass-through when input already has a suffix", () => {
    assert.equal(toWaJid("167250388615354@lid"), "167250388615354@lid");
    assert.equal(toWaJid("123456789@c.us"), "123456789@c.us");
  });

  test("null / empty → null", () => {
    assert.equal(toWaJid(null), null);
    assert.equal(toWaJid(""), null);
  });
});

describe("isLidJid", () => {
  test("true only for @lid suffix", () => {
    assert.equal(isLidJid("167250388615354@lid"), true);
    assert.equal(isLidJid("919999999999@c.us"), false);
    assert.equal(isLidJid("919999999999"), false);
    assert.equal(isLidJid("123-456@g.us"), false);
  });

  test("safe on null / undefined / empty", () => {
    assert.equal(isLidJid(null), false);
    assert.equal(isLidJid(undefined), false);
    assert.equal(isLidJid(""), false);
  });

  test("doesn't false-positive on @lid embedded mid-string", () => {
    // We only match the suffix.
    assert.equal(isLidJid("@lid-something"), false);
    assert.equal(isLidJid("foo@lid.example"), false);
  });
});

describe("normalizeMobile", () => {
  test("trims whitespace", () => {
    assert.equal(normalizeMobile("  +919999999999  "), "+919999999999");
  });

  test("preserves @lid suffix unchanged — UI is responsible for the (private) label", () => {
    assert.equal(normalizeMobile("167250388615354@lid"), "167250388615354@lid");
  });

  test("null / undefined → null", () => {
    assert.equal(normalizeMobile(null), null);
    assert.equal(normalizeMobile(undefined), null);
  });
});
