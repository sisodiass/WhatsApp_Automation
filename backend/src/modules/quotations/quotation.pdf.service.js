// Quotation PDF renderer.
//
// Uses PDFKit (small, stream-based, no headless browser). Output is
// written to uploads/quotations/<id>.pdf. The route /api/quotations/:id/pdf
// streams the file back.
//
// PDFKit is loaded lazily so the app boots even when the dep isn't
// installed yet (until `npm install pdfkit` lands in the worker image).

import fs from "node:fs";
import path from "node:path";
import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";

const log = child("quote-pdf");

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const QUOTES_DIR = path.join(UPLOADS_DIR, "quotations");

function ensureDir() {
  fs.mkdirSync(QUOTES_DIR, { recursive: true });
}

function money(amount, currency) {
  const n = Number(amount);
  return `${currency} ${Number.isFinite(n) ? n.toFixed(2) : amount}`;
}

async function loadPdfKit() {
  try {
    const mod = await import("pdfkit");
    return mod.default || mod;
  } catch {
    return null;
  }
}

export async function renderQuotationPdf(tenantId, id) {
  ensureDir();
  const q = await prisma.quotation.findFirst({
    where: { id, tenantId },
    include: {
      contact: true,
      lineItems: { orderBy: { position: "asc" } },
      tenant: { select: { name: true } },
    },
  });
  if (!q) throw new Error("quotation not found");

  const PDFDocument = await loadPdfKit();
  const filename = `${q.id}.pdf`;
  const filePath = path.join(QUOTES_DIR, filename);

  if (!PDFDocument) {
    // Graceful fallback when pdfkit is not installed: write a text file
    // so the rest of the flow still works in dev.
    log.warn("pdfkit not installed; writing text fallback", { id });
    const lines = [
      `QUOTATION ${q.number}`,
      `From: ${q.tenant.name}`,
      `To: ${[q.contact.firstName, q.contact.lastName].filter(Boolean).join(" ")} (${q.contact.mobile})`,
      `Valid until: ${q.validUntil.toISOString().slice(0, 10)}`,
      "",
      "Items:",
      ...q.lineItems.map((li) =>
        `  ${li.position + 1}. ${li.description} — qty ${li.qty} @ ${money(li.unitPrice, q.currency)} = ${money(li.lineTotal, q.currency)}`,
      ),
      "",
      `Subtotal:  ${money(q.subtotal, q.currency)}`,
      `Discount:  -${money(q.discountTotal, q.currency)}`,
      `Tax:       ${money(q.taxTotal, q.currency)}`,
      `Total:     ${money(q.grandTotal, q.currency)}`,
      "",
      q.terms || "",
    ];
    fs.writeFileSync(filePath.replace(/\.pdf$/, ".txt"), lines.join("\n"), "utf8");
    return filePath.replace(/\.pdf$/, ".txt");
  }

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Header
    doc
      .fontSize(18)
      .fillColor("#0f172a")
      .text(q.tenant.name, { align: "left" })
      .moveDown(0.2)
      .fontSize(11)
      .fillColor("#475569")
      .text("Quotation", { align: "left" });

    doc
      .fontSize(11)
      .fillColor("#0f172a")
      .text(`#${q.number}`, 400, 50, { align: "right" })
      .text(`Date: ${q.createdAt.toISOString().slice(0, 10)}`, { align: "right" })
      .text(`Valid until: ${q.validUntil.toISOString().slice(0, 10)}`, { align: "right" });

    doc.moveDown(2);

    // Bill to
    doc.fontSize(11).fillColor("#475569").text("Billed to", 50, 150);
    const billTo = [
      [q.contact.firstName, q.contact.lastName].filter(Boolean).join(" ") || q.contact.mobile,
      q.contact.company,
      q.contact.email,
      q.contact.mobile,
      [q.contact.city, q.contact.state, q.contact.country].filter(Boolean).join(", "),
    ]
      .filter((s) => s && String(s).trim())
      .join("\n");
    doc.fontSize(11).fillColor("#0f172a").text(billTo, 50, 165);

    doc.moveDown(2);

    // Items table header
    const tableTop = 240;
    doc.fontSize(10).fillColor("#475569");
    doc.text("#", 50, tableTop);
    doc.text("Description", 80, tableTop);
    doc.text("Qty", 320, tableTop, { width: 50, align: "right" });
    doc.text("Unit", 370, tableTop, { width: 70, align: "right" });
    doc.text("Total", 440, tableTop, { width: 100, align: "right" });
    doc
      .strokeColor("#e2e8f0")
      .moveTo(50, tableTop + 16)
      .lineTo(545, tableTop + 16)
      .stroke();

    let y = tableTop + 24;
    doc.fillColor("#0f172a");
    q.lineItems.forEach((li, i) => {
      doc.fontSize(10).text(String(i + 1), 50, y);
      doc.text(li.description, 80, y, { width: 230 });
      doc.text(String(li.qty), 320, y, { width: 50, align: "right" });
      doc.text(money(li.unitPrice, q.currency), 370, y, {
        width: 70,
        align: "right",
      });
      doc.text(money(li.lineTotal, q.currency), 440, y, {
        width: 100,
        align: "right",
      });
      y += Math.max(20, doc.heightOfString(li.description, { width: 230 }) + 4);
    });

    y += 10;
    doc.strokeColor("#e2e8f0").moveTo(50, y).lineTo(545, y).stroke();
    y += 12;

    // Totals
    const totalsX = 370;
    doc.fontSize(10).fillColor("#475569");
    doc.text("Subtotal", totalsX, y, { width: 70, align: "right" });
    doc
      .fillColor("#0f172a")
      .text(money(q.subtotal, q.currency), 440, y, { width: 100, align: "right" });
    y += 16;
    doc.fillColor("#475569").text("Discount", totalsX, y, { width: 70, align: "right" });
    doc
      .fillColor("#0f172a")
      .text(`-${money(q.discountTotal, q.currency)}`, 440, y, { width: 100, align: "right" });
    y += 16;
    doc.fillColor("#475569").text("Tax", totalsX, y, { width: 70, align: "right" });
    doc
      .fillColor("#0f172a")
      .text(money(q.taxTotal, q.currency), 440, y, { width: 100, align: "right" });
    y += 18;
    doc
      .strokeColor("#cbd5e1")
      .moveTo(totalsX - 10, y)
      .lineTo(545, y)
      .stroke();
    y += 6;
    doc.fontSize(12).fillColor("#0f172a");
    doc.text("Total", totalsX, y, { width: 70, align: "right" });
    doc.text(money(q.grandTotal, q.currency), 440, y, { width: 100, align: "right" });

    // Terms
    if (q.terms) {
      doc.moveDown(3);
      doc.fontSize(10).fillColor("#475569").text("Terms");
      doc.fontSize(10).fillColor("#0f172a").text(q.terms);
    }

    if (q.notes) {
      doc.moveDown(1);
      doc.fontSize(10).fillColor("#475569").text("Notes");
      doc.fontSize(10).fillColor("#0f172a").text(q.notes);
    }

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return filePath;
}

// Stream-or-read for the GET /pdf route.
export function getQuotationPdfPath(_tenantId, id) {
  ensureDir();
  const pdfPath = path.join(QUOTES_DIR, `${id}.pdf`);
  if (fs.existsSync(pdfPath)) return pdfPath;
  const txtPath = path.join(QUOTES_DIR, `${id}.txt`);
  if (fs.existsSync(txtPath)) return txtPath;
  return null;
}
