// Unit tests for quotation totals. Pure Decimal math — no DB.
// Catches drift if anyone touches the formula in the future; especially
// important because we use it as the source of truth for money values.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeLineTotal, computeQuotationTotals } from "../../src/modules/quotations/quotation.totals.js";

function eq(a, expected) {
  // Decimal -> string -> assertion. Avoids float comparison.
  assert.equal(a.toString(), expected);
}

describe("computeLineTotal", () => {
  test("zero-discount, zero-tax: total = qty * unitPrice", () => {
    const t = computeLineTotal({ qty: 3, unitPrice: 100, discountPct: 0, taxRatePct: 0 });
    eq(t.gross, "300");
    eq(t.discount, "0");
    eq(t.taxable, "300");
    eq(t.tax, "0");
    eq(t.total, "300");
  });

  test("18% tax applied after gross (no discount)", () => {
    const t = computeLineTotal({ qty: 1, unitPrice: 100, discountPct: 0, taxRatePct: 18 });
    eq(t.gross, "100");
    eq(t.taxable, "100");
    eq(t.tax, "18");
    eq(t.total, "118");
  });

  test("discount applies before tax", () => {
    // 100 - 10% = 90 taxable; tax 18% of 90 = 16.20; total = 106.20
    const t = computeLineTotal({ qty: 1, unitPrice: 100, discountPct: 10, taxRatePct: 18 });
    eq(t.gross, "100");
    eq(t.discount, "10");
    eq(t.taxable, "90");
    eq(t.tax, "16.2");
    eq(t.total, "106.2");
  });

  test("decimal qty (fractional units)", () => {
    const t = computeLineTotal({ qty: "1.5", unitPrice: "10.50", discountPct: 0, taxRatePct: 0 });
    eq(t.gross, "15.75");
    eq(t.total, "15.75");
  });

  test("zero qty returns zero everywhere (defensive)", () => {
    const t = computeLineTotal({ qty: 0, unitPrice: 100, discountPct: 50, taxRatePct: 18 });
    eq(t.total, "0");
    eq(t.tax, "0");
  });

  test("undefined/null inputs default to zero (defensive)", () => {
    const t = computeLineTotal({});
    eq(t.gross, "0");
    eq(t.total, "0");
  });

  test("100% discount: total = 0 even with tax", () => {
    const t = computeLineTotal({ qty: 1, unitPrice: 1000, discountPct: 100, taxRatePct: 18 });
    eq(t.discount, "1000");
    eq(t.taxable, "0");
    eq(t.tax, "0");
    eq(t.total, "0");
  });
});

describe("computeQuotationTotals — sum across lines", () => {
  test("three lines aggregate correctly", () => {
    const totals = computeQuotationTotals([
      { qty: 1, unitPrice: 100, discountPct: 0, taxRatePct: 18 }, // total 118
      { qty: 2, unitPrice: 50, discountPct: 10, taxRatePct: 18 }, // gross 100, discount 10, tax 16.2, total 106.2
      { qty: 1, unitPrice: 200, discountPct: 0, taxRatePct: 0 },  // total 200
    ]);
    eq(totals.subtotal, "400");      // 100 + 100 + 200
    eq(totals.discountTotal, "10");
    eq(totals.taxTotal, "34.2");     // 18 + 16.2 + 0
    eq(totals.grandTotal, "424.2");  // 118 + 106.2 + 200
  });

  test("empty lines list returns zeros", () => {
    const totals = computeQuotationTotals([]);
    eq(totals.subtotal, "0");
    eq(totals.grandTotal, "0");
  });

  test("string-typed inputs (from JSON payloads) work the same as numbers", () => {
    const a = computeQuotationTotals([{ qty: "2", unitPrice: "50", discountPct: "0", taxRatePct: "18" }]);
    const b = computeQuotationTotals([{ qty: 2, unitPrice: 50, discountPct: 0, taxRatePct: 18 }]);
    eq(a.grandTotal, b.grandTotal.toString());
  });
});
