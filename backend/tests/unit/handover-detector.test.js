// Unit tests for the M11.B3 keyword-driven handover detector.
// Pure function — no DB, no AI. Runs in milliseconds.
//
// Run: npm test  (from backend/)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateHandover } from "../../src/modules/ai/handover-detector.js";

describe("evaluateHandover — human-request gate", () => {
  test("matches single keyword on word boundary", () => {
    const r = evaluateHandover("I want a human", { "handover.human_request_enabled": true });
    assert.equal(r.flip, true);
    assert.equal(r.reason, "KEYWORD_TRIGGER");
    assert.equal(r.matched, "human");
  });

  test("matches multi-word phrase contiguously", () => {
    const r = evaluateHandover("Can I speak to someone now?", {
      "handover.human_request_enabled": true,
    });
    assert.equal(r.flip, true);
    assert.equal(r.matched, "speak to someone");
  });

  test("word-boundary safety: 'humanitarian' does NOT match 'human'", () => {
    const r = evaluateHandover("The humanitarian crisis is bad", {
      "handover.human_request_enabled": true,
    });
    assert.equal(r.flip, false);
    assert.equal(r.matched, null);
  });

  test("case-insensitive", () => {
    const r = evaluateHandover("CONNECT ME WITH CUSTOMER SERVICE NOW", {
      "handover.human_request_enabled": true,
    });
    assert.equal(r.flip, true);
    assert.equal(r.matched, "customer service");
  });

  test("handles trailing punctuation and extra whitespace", () => {
    const r = evaluateHandover("  please   get   me   an   agent!!!  ", {
      "handover.human_request_enabled": true,
    });
    assert.equal(r.flip, true);
    assert.equal(r.matched, "agent");
  });

  test("disabled flag short-circuits", () => {
    const r = evaluateHandover("Talk to a human", { "handover.human_request_enabled": false });
    assert.equal(r.flip, false);
  });

  test("operator-tuned keyword list overrides default", () => {
    const r = evaluateHandover("I want a salesman", {
      "handover.human_request_enabled": true,
      "handover.human_request_keywords": "salesman,team rep",
    });
    assert.equal(r.flip, true);
    assert.equal(r.matched, "salesman");
  });

  test("blank operator list falls back to defaults", () => {
    const r = evaluateHandover("Talk to a human", {
      "handover.human_request_enabled": true,
      "handover.human_request_keywords": "",
    });
    assert.equal(r.flip, true);
    assert.equal(r.matched, "human");
  });
});

describe("evaluateHandover — negative-sentiment gate (opt-in)", () => {
  test("default OFF — does not fire even on furious text", () => {
    const r = evaluateHandover("This is terrible and I'm furious", {});
    assert.equal(r.flip, false);
  });

  test("opt-in ON — fires on first matching keyword", () => {
    const r = evaluateHandover("This is terrible and I'm furious", {
      "handover.negative_sentiment_enabled": true,
    });
    assert.equal(r.flip, true);
    assert.equal(r.reason, "NEGATIVE_SENTIMENT");
    // Either "terrible" or "furious" is a valid match — iteration-order
    // dependent. Assert it's one of them rather than pinning to a specific
    // word so re-ordering the default list doesn't break the test.
    assert.ok(["terrible", "furious", "frustrated"].includes(r.matched));
  });

  test("human-request wins over negative-sentiment when both enabled", () => {
    const r = evaluateHandover("This product is terrible, get me a human now", {
      "handover.human_request_enabled": true,
      "handover.negative_sentiment_enabled": true,
    });
    assert.equal(r.flip, true);
    // Human-request is gate 4a; sentiment is gate 4b. 4a fires first.
    assert.equal(r.reason, "KEYWORD_TRIGGER");
  });
});

describe("evaluateHandover — edge cases", () => {
  test("empty body returns no-match", () => {
    assert.deepEqual(evaluateHandover("", { "handover.human_request_enabled": true }), {
      flip: false,
      reason: null,
      matched: null,
    });
  });

  test("null body returns no-match", () => {
    assert.deepEqual(evaluateHandover(null, { "handover.human_request_enabled": true }), {
      flip: false,
      reason: null,
      matched: null,
    });
  });

  test("undefined body returns no-match", () => {
    assert.deepEqual(
      evaluateHandover(undefined, { "handover.human_request_enabled": true }),
      { flip: false, reason: null, matched: null },
    );
  });

  test("normal sales question does NOT trigger handover", () => {
    const r = evaluateHandover("Hi I want to buy a Pro plan today", {
      "handover.human_request_enabled": true,
    });
    assert.equal(r.flip, false);
  });

  test("regex metacharacters in keyword are escaped safely", () => {
    // Without escaping, "$" would be treated as end-of-line and never match.
    const r = evaluateHandover("send me the $99 plan", {
      "handover.human_request_enabled": true,
      "handover.human_request_keywords": "$99,human",
    });
    assert.equal(r.flip, true);
    assert.equal(r.matched, "$99");
  });
});
