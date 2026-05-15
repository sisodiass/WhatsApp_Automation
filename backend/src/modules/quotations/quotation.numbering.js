// Quotation/Invoice number generator. Sequence per (tenant, year).
//
// Format placeholders ({prefix}, {yyyy}, {seq:N}) are read from settings
// at call time. The sequence is computed by SELECTing the highest existing
// number for this year and incrementing — racy, but the unique constraint
// catches collisions and the caller retries.

import { prisma } from "../../shared/prisma.js";

function pad(n, width) {
  const s = String(n);
  return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

function applyFormat(format, prefix, year, seq) {
  return format
    .replace("{prefix}", prefix)
    .replace("{yyyy}", String(year))
    .replace(/\{seq(?::(\d+))?\}/, (_, width) => (width ? pad(seq, Number(width)) : String(seq)));
}

// Counts current rows for the year/prefix to compute the next seq.
async function nextSeqForQuotation(tenantId, prefix, year) {
  const rows = await prisma.quotation.findMany({
    where: {
      tenantId,
      number: { startsWith: `${prefix}-${year}-` },
    },
    select: { number: true },
  });
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)$/.exec(r.number);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

async function nextSeqForInvoice(tenantId, prefix, year) {
  const rows = await prisma.invoice.findMany({
    where: {
      tenantId,
      number: { startsWith: `${prefix}-${year}-` },
    },
    select: { number: true },
  });
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)$/.exec(r.number);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export async function generateQuotationNumber(tenantId, settings) {
  const prefix = settings["quotations.number_prefix"] || "QTN";
  const format = settings["quotations.number_format"] || "{prefix}-{yyyy}-{seq:06}";
  const year = new Date().getUTCFullYear();
  const seq = await nextSeqForQuotation(tenantId, prefix, year);
  return applyFormat(format, prefix, year, seq);
}

export async function generateInvoiceNumber(tenantId, settings) {
  const prefix = settings["invoices.number_prefix"] || "INV";
  const format = settings["invoices.number_format"] || "{prefix}-{yyyy}-{seq:06}";
  const year = new Date().getUTCFullYear();
  const seq = await nextSeqForInvoice(tenantId, prefix, year);
  return applyFormat(format, prefix, year, seq);
}
