// Unit tests for the M11.B4 mode-aware buildSuggestionsPrompt.
// Verifies the prompt builder injects mode-specific guidance and never
// regresses the default M7 baseline.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSuggestionsPrompt } from "../../src/modules/ai/prompts.js";

describe("buildSuggestionsPrompt — default mode (M7 baseline)", () => {
  test("no ctx → default mode (back-compat)", () => {
    const p = buildSuggestionsPrompt("professional");
    assert.ok(/suggesting reply options/.test(p));
    assert.ok(!/MODE:/.test(p), "no MODE marker in default output");
    assert.ok(/Suggest exactly 3 distinct reply options/.test(p));
  });

  test("explicit ctx.mode=default also produces default output", () => {
    const p = buildSuggestionsPrompt("brief", { mode: "default" });
    assert.ok(!/MODE: objection-handling/.test(p));
    assert.ok(!/MODE: upsell-aware/.test(p));
  });

  test("tone hint changes between professional/friendly/brief", () => {
    const a = buildSuggestionsPrompt("professional");
    const b = buildSuggestionsPrompt("friendly");
    const c = buildSuggestionsPrompt("brief");
    assert.notEqual(a, b);
    assert.notEqual(b, c);
    assert.ok(/polished/.test(a));
    assert.ok(/warm/.test(b));
    assert.ok(/terse/.test(c));
  });

  test("unknown tone falls back to a safe default phrasing", () => {
    const p = buildSuggestionsPrompt("garbage-tone");
    assert.ok(/natural conversational phrasing/.test(p));
  });
});

describe("buildSuggestionsPrompt — objection-handling mode", () => {
  test("includes MODE marker and the 3-prong structure", () => {
    const p = buildSuggestionsPrompt("professional", { mode: "objection-handling" });
    assert.ok(/MODE: objection-handling/.test(p));
    assert.ok(/Acknowledge the concern/.test(p));
    assert.ok(/Re-frame the value/.test(p));
    assert.ok(/low-friction next step/.test(p));
  });

  test("lastObjection (if provided) is surfaced to the AI", () => {
    const p = buildSuggestionsPrompt("professional", {
      mode: "objection-handling",
      lastObjection: "price too high",
    });
    assert.ok(/Detected objection focus: price too high/.test(p));
  });

  test("lastObjection is optional — absent fact doesn't leak 'undefined'", () => {
    const p = buildSuggestionsPrompt("professional", { mode: "objection-handling" });
    assert.ok(!/undefined/.test(p));
  });
});

describe("buildSuggestionsPrompt — upsell-aware mode", () => {
  test("includes MODE marker and upsell guidance", () => {
    const p = buildSuggestionsPrompt("professional", { mode: "upsell-aware" });
    assert.ok(/MODE: upsell-aware/.test(p));
    assert.ok(/AT LEAST ONE proposes a relevant add-on/.test(p));
    assert.ok(/without sounding pushy/.test(p));
  });

  test("candidate products are listed by name + price", () => {
    const p = buildSuggestionsPrompt("professional", {
      mode: "upsell-aware",
      candidateProducts: [
        { name: "Analytics Add-on", basePrice: "199.00", currency: "INR" },
        { name: "Priority Support", basePrice: "99.00", currency: "INR" },
      ],
    });
    assert.ok(/Analytics Add-on/.test(p));
    assert.ok(/INR 199.00/.test(p));
    assert.ok(/Priority Support/.test(p));
  });

  test("more than 5 candidates → only first 5 included", () => {
    const products = Array.from({ length: 8 }, (_, i) => ({ name: `Product ${i}` }));
    const p = buildSuggestionsPrompt("professional", {
      mode: "upsell-aware",
      candidateProducts: products,
    });
    assert.ok(/Product 0/.test(p));
    assert.ok(/Product 4/.test(p));
    // Index 5+ are dropped by the .slice(0, 5).
    assert.ok(!/Product 5/.test(p));
    assert.ok(!/Product 7/.test(p));
  });

  test("interestedProduct surfaces as primary interest line", () => {
    const p = buildSuggestionsPrompt("professional", {
      mode: "upsell-aware",
      candidateProducts: [{ name: "X" }],
      interestedProduct: "WhatsApp CRM",
    });
    assert.ok(/Customer's primary interest: WhatsApp CRM/.test(p));
  });

  test("empty candidates list doesn't render the 'Candidate add-on' header", () => {
    const p = buildSuggestionsPrompt("professional", {
      mode: "upsell-aware",
      candidateProducts: [],
    });
    // Header only renders when there's at least one product to list.
    assert.ok(!/Candidate add-on products/.test(p));
  });
});

describe("buildSuggestionsPrompt — output contract", () => {
  test("always asks for JSON output, never markdown", () => {
    for (const mode of ["default", "objection-handling", "upsell-aware"]) {
      const p = buildSuggestionsPrompt("professional", { mode, candidateProducts: [{ name: "X" }] });
      assert.ok(/Output ONLY a JSON object/.test(p), `mode=${mode}`);
      assert.ok(/No prose, no markdown fence/.test(p), `mode=${mode}`);
      assert.ok(/Exactly 3 strings/.test(p), `mode=${mode}`);
    }
  });
});
