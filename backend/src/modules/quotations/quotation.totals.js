// Pure functions over line items → totals. All math uses Prisma.Decimal
// to avoid float drift. Caller passes raw inputs; we return Decimal values
// you can either persist directly or convert to .toString() for clients.

import { Prisma } from "@prisma/client";

const D = (v) => new Prisma.Decimal(v ?? 0);
const HUNDRED = D(100);

export function computeLineTotal({ qty, unitPrice, discountPct, taxRatePct }) {
  const gross = D(qty).mul(D(unitPrice));
  const afterDiscount = gross.mul(HUNDRED.minus(D(discountPct))).div(HUNDRED);
  const tax = afterDiscount.mul(D(taxRatePct)).div(HUNDRED);
  return {
    gross,
    discount: gross.minus(afterDiscount),
    taxable: afterDiscount,
    tax,
    total: afterDiscount.plus(tax),
  };
}

export function computeQuotationTotals(lineItems) {
  let subtotal = D(0); // sum of (qty * unitPrice), pre-discount
  let discountTotal = D(0);
  let taxTotal = D(0);
  let grandTotal = D(0);
  for (const li of lineItems) {
    const t = computeLineTotal(li);
    subtotal = subtotal.plus(t.gross);
    discountTotal = discountTotal.plus(t.discount);
    taxTotal = taxTotal.plus(t.tax);
    grandTotal = grandTotal.plus(t.total);
  }
  return { subtotal, discountTotal, taxTotal, grandTotal };
}
