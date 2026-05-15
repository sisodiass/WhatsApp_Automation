// Quotation service. CRUD + state machine + revision flow.
//
// State machine:
//   DRAFT → SENT     (send())
//   SENT  → ACCEPTED (accept(), or webhook side-effect on payment)
//   SENT  → REJECTED (reject())
//   SENT  → EXPIRED  (sweepExpired())
//   SENT|ACCEPTED → REVISED (revise() — current becomes REVISED, returns new DRAFT)
//
// SEND requires lineItems > 0; if grandTotal >= approval_threshold a
// QuotationApproval row must be APPROVED first. SEND also moves the
// linked lead to "Quotation Sent" stage if one exists; ACCEPTED moves
// to "Negotiation"; payment-driven ACCEPT (via setAcceptedAndWin) moves
// directly to "Won". All stage moves go through lead.service.moveLeadStage
// so the existing automation subscriber fires unchanged.

import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound, Forbidden } from "../../shared/errors.js";
import { child } from "../../shared/logger.js";
import { emit, Events } from "../../shared/events.js";
import { getSettings } from "../settings/settings.service.js";
import { interpolate } from "../templates/template.service.js";
import { buildContactVars, buildStandardVars } from "../templates/variables.js";
import { enqueueOutbound } from "../queue/producers.js";
import { moveLeadStage } from "../leads/lead.service.js";
import { generateQuotationNumber } from "./quotation.numbering.js";
import {
  computeLineTotal,
  computeQuotationTotals,
} from "./quotation.totals.js";

const log = child("quotation");

const QUOTATION_INCLUDE = {
  contact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      mobile: true,
      email: true,
      company: true,
    },
  },
  lead: {
    select: {
      id: true,
      stage: { select: { id: true, name: true, category: true } },
      pipeline: { select: { id: true, name: true } },
    },
  },
  createdBy: { select: { id: true, name: true, email: true } },
  lineItems: { orderBy: { position: "asc" } },
  approvals: { orderBy: { requestedAt: "desc" } },
  paymentLinks: {
    select: {
      id: true,
      status: true,
      provider: true,
      amount: true,
      currency: true,
      shortUrl: true,
      paidAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  },
};

function asNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeLineItem(li, position) {
  if (!li.description?.toString().trim()) {
    throw BadRequest("each line item needs a description");
  }
  const qty = new Prisma.Decimal(li.qty ?? 0);
  if (qty.lte(0)) throw BadRequest("line qty must be > 0");
  const unitPrice = new Prisma.Decimal(li.unitPrice ?? 0);
  const discountPct = new Prisma.Decimal(li.discountPct ?? 0);
  const taxRatePct = new Prisma.Decimal(li.taxRatePct ?? 0);
  const t = computeLineTotal({ qty, unitPrice, discountPct, taxRatePct });
  return {
    productId: li.productId ?? null,
    position,
    description: String(li.description).trim().slice(0, 500),
    qty,
    unitPrice,
    discountPct,
    taxRatePct,
    lineTotal: t.total,
  };
}

// ─── List + read ────────────────────────────────────────────────────

export async function listQuotations(tenantId, opts = {}) {
  const {
    search,
    status,
    leadId,
    contactId,
    page = 1,
    pageSize = 50,
    includeDeleted = false,
  } = opts;
  const where = {
    tenantId,
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(status ? { status } : {}),
    ...(leadId ? { leadId } : {}),
    ...(contactId ? { contactId } : {}),
    ...(search
      ? {
          OR: [
            { number: { contains: search, mode: "insensitive" } },
            { notes: { contains: search, mode: "insensitive" } },
            {
              contact: {
                OR: [
                  { firstName: { contains: search, mode: "insensitive" } },
                  { lastName: { contains: search, mode: "insensitive" } },
                  { mobile: { contains: search } },
                  { email: { contains: search, mode: "insensitive" } },
                  { company: { contains: search, mode: "insensitive" } },
                ],
              },
            },
          ],
        }
      : {}),
  };
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const [items, total] = await Promise.all([
    prisma.quotation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            mobile: true,
            company: true,
          },
        },
        lead: { select: { id: true, stage: { select: { name: true } } } },
        _count: { select: { lineItems: true, paymentLinks: true } },
      },
    }),
    prisma.quotation.count({ where }),
  ]);
  return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
}

export async function getQuotation(tenantId, id) {
  const q = await prisma.quotation.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: QUOTATION_INCLUDE,
  });
  if (!q) throw NotFound("quotation not found");
  return q;
}

// ─── Create + update ────────────────────────────────────────────────

export async function createQuotation(tenantId, data, actorId) {
  if (!data.contactId) throw BadRequest("contactId required");
  if (!Array.isArray(data.lineItems) || data.lineItems.length === 0) {
    throw BadRequest("at least one line item required");
  }
  const contact = await prisma.contact.findFirst({
    where: { id: data.contactId, tenantId, deletedAt: null },
  });
  if (!contact) throw NotFound("contact not found");

  if (data.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: data.leadId, tenantId },
    });
    if (!lead) throw NotFound("lead not found");
  }

  const settings = await getSettings(tenantId, [
    "quotations.default_validity_days",
    "quotations.terms_default",
    "quotations.number_prefix",
    "quotations.number_format",
    "payments.currency_default",
  ]);
  const validityDays = Number(settings["quotations.default_validity_days"] ?? 14);
  const validUntil = data.validUntil
    ? new Date(data.validUntil)
    : new Date(Date.now() + validityDays * 24 * 3600 * 1000);
  const currency =
    data.currency?.toString().toUpperCase().slice(0, 3) ||
    settings["payments.currency_default"] ||
    "INR";

  // Validate line items first (throws on bad input) so we don't reserve a number
  const lines = data.lineItems.map((li, i) => normalizeLineItem(li, i));
  const totals = computeQuotationTotals(lines);

  // Generate number with one retry on unique-violation race.
  for (let attempt = 0; attempt < 2; attempt++) {
    const number = await generateQuotationNumber(tenantId, settings);
    try {
      return await prisma.$transaction(async (tx) => {
        const q = await tx.quotation.create({
          data: {
            tenantId,
            number,
            leadId: data.leadId ?? null,
            contactId: data.contactId,
            status: "DRAFT",
            currency,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            taxTotal: totals.taxTotal,
            grandTotal: totals.grandTotal,
            validUntil,
            terms: data.terms ?? settings["quotations.terms_default"] ?? null,
            notes: data.notes ?? null,
            version: 1,
            createdById: actorId ?? null,
            draftedByAi: !!data.draftedByAi,
            lineItems: { create: lines },
          },
          include: QUOTATION_INCLUDE,
        });
        return q;
      });
    } catch (err) {
      if (err.code === "P2002" && attempt === 0) {
        log.warn("quotation number collision, retrying", { number });
        continue;
      }
      throw err;
    }
  }
  throw new Error("failed to generate unique quotation number");
}

export async function updateQuotation(tenantId, id, data) {
  const q = await prisma.quotation.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!q) throw NotFound("quotation not found");
  if (q.status !== "DRAFT") {
    throw BadRequest(`only DRAFT quotations can be edited (current: ${q.status})`);
  }
  const next = {};
  if (data.validUntil !== undefined) next.validUntil = new Date(data.validUntil);
  if (data.terms !== undefined) next.terms = data.terms;
  if (data.notes !== undefined) next.notes = data.notes;
  if (data.currency !== undefined) {
    next.currency = String(data.currency).toUpperCase().slice(0, 3);
  }

  let replaceLines = null;
  if (Array.isArray(data.lineItems)) {
    replaceLines = data.lineItems.map((li, i) => normalizeLineItem(li, i));
    const totals = computeQuotationTotals(replaceLines);
    next.subtotal = totals.subtotal;
    next.discountTotal = totals.discountTotal;
    next.taxTotal = totals.taxTotal;
    next.grandTotal = totals.grandTotal;
  }

  return prisma.$transaction(async (tx) => {
    if (replaceLines) {
      await tx.quotationLineItem.deleteMany({ where: { quotationId: id } });
      await tx.quotationLineItem.createMany({
        data: replaceLines.map((l) => ({ ...l, quotationId: id })),
      });
    }
    return tx.quotation.update({
      where: { id },
      data: next,
      include: QUOTATION_INCLUDE,
    });
  });
}

export async function softDeleteQuotation(tenantId, id) {
  const q = await prisma.quotation.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!q) throw NotFound("quotation not found");
  if (q.status !== "DRAFT") {
    throw BadRequest("only DRAFT quotations can be deleted");
  }
  await prisma.quotation.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  return { ok: true };
}

// ─── State transitions ─────────────────────────────────────────────

// Resolve the stage to move the lead to for a given semantic transition.
// Returns null if the lead has no stage by that label — caller skips silently.
async function resolveStage(tenantId, lead, stageName) {
  if (!lead) return null;
  const stage = await prisma.stage.findFirst({
    where: {
      pipelineId: lead.pipelineId,
      name: { equals: stageName, mode: "insensitive" },
    },
  });
  return stage;
}

async function moveLeadIfDifferent(tenantId, leadId, stageName) {
  if (!leadId) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  const stage = await resolveStage(tenantId, lead, stageName);
  if (!stage || stage.id === lead.stageId) return;
  try {
    await moveLeadStage(tenantId, leadId, stage.id, null);
  } catch (err) {
    log.warn("lead stage move failed", { leadId, stageName, err: err.message });
  }
}

export async function sendQuotation(tenantId, id, actorId) {
  const q = await prisma.quotation.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: { lineItems: true, approvals: true },
  });
  if (!q) throw NotFound("quotation not found");
  if (q.status !== "DRAFT") {
    throw BadRequest(`quotation is ${q.status}; only DRAFT can be sent`);
  }
  if (!q.lineItems.length) throw BadRequest("quotation has no line items");

  // Approval gate.
  const settings = await getSettings(tenantId, [
    "quotations.approval_threshold_amount",
  ]);
  const threshold = new Prisma.Decimal(
    settings["quotations.approval_threshold_amount"] ?? 0,
  );
  if (threshold.gt(0) && new Prisma.Decimal(q.grandTotal).gte(threshold)) {
    const approved = q.approvals.find((a) => a.status === "APPROVED");
    if (!approved) {
      throw Forbidden(
        `quotation requires approval (grand total ≥ ${threshold.toString()}); request via /approvals`,
      );
    }
  }

  const updated = await prisma.quotation.update({
    where: { id },
    data: { status: "SENT", sentAt: new Date() },
    include: QUOTATION_INCLUDE,
  });

  // Move linked lead.
  await moveLeadIfDifferent(tenantId, q.leadId, "Quotation Sent");

  // Enqueue async: render PDF + send via outbound dispatcher.
  // The send-quote queue is not registered yet (kept lazy on first call);
  // instead we send the quote text directly through the existing
  // outbound path so this also works in single-process dev. PDF is
  // rendered inline and saved; if pdfPath fails we still send the link.
  await dispatchQuoteToCustomer(tenantId, updated).catch((err) =>
    log.warn("dispatchQuote failed", { id, err: err.message }),
  );

  return updated;
}

// Caller-side wrapper used by send action + the AI seam after approval.
// Renders PDF, persists pdfPath, creates an OUT Message for the chat, and
// enqueues outbound. If no chat exists yet for the contact, we skip the
// chat dispatch but still mark sent (operator can manually send the PDF).
async function dispatchQuoteToCustomer(tenantId, quote) {
  const { renderQuotationPdf } = await import("./quotation.pdf.service.js");
  let pdfPath = null;
  try {
    pdfPath = await renderQuotationPdf(tenantId, quote.id);
    await prisma.quotation.update({
      where: { id: quote.id },
      data: { pdfPath },
    });
  } catch (err) {
    log.error("pdf render failed", { id: quote.id, err: err.message });
  }

  const contact = await prisma.contact.findUnique({
    where: { id: quote.contactId },
    include: {
      chats: {
        take: 1,
        orderBy: { lastMessageAt: "desc" },
        include: { channel: true },
      },
    },
  });
  const chat = contact?.chats?.[0];
  if (!chat) {
    log.info("no chat for contact; skipping chat dispatch", { id: quote.id });
    return;
  }

  const tpl = await prisma.messageTemplate.findFirst({
    where: { tenantId, name: "quote_sent", isActive: true },
  });
  const vars = {
    ...buildStandardVars(),
    ...buildContactVars(contact),
    quote_number: quote.number,
    currency: quote.currency,
    grand_total: String(quote.grandTotal),
    valid_until: new Date(quote.validUntil).toISOString().slice(0, 10),
    pdf_url: pdfPath ? `/api/quotations/${quote.id}/pdf` : "",
  };
  const body = tpl
    ? interpolate(tpl.content, vars)
    : `Your quotation ${quote.number} for ${quote.currency} ${quote.grandTotal} is ready.`;

  let session = await prisma.chatSession.findFirst({
    where: { chatId: chat.id, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!session) {
    session = await prisma.chatSession.create({
      data: { chatId: chat.id, state: "ACTIVE", mode: "AI" },
    });
  }
  const msg = await prisma.message.create({
    data: {
      sessionId: session.id,
      direction: "OUT",
      source: "SYSTEM",
      body,
      kbChunkIds: [],
    },
  });

  if (quote.leadId) {
    await prisma.leadActivity.create({
      data: {
        leadId: quote.leadId,
        kind: "MESSAGE",
        messageId: msg.id,
        data: { event: "quotation_sent", quotationId: quote.id },
      },
    });
  }

  await enqueueOutbound(msg.id);
}

export async function acceptQuotation(tenantId, id, _actorId) {
  const q = await prisma.quotation.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!q) throw NotFound("quotation not found");
  if (q.status !== "SENT") {
    throw BadRequest(`quotation is ${q.status}; only SENT can be accepted`);
  }
  const updated = await prisma.quotation.update({
    where: { id },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
    include: QUOTATION_INCLUDE,
  });
  await moveLeadIfDifferent(tenantId, q.leadId, "Negotiation");
  emit(Events.QUOTATION_ACCEPTED, {
    tenantId,
    quotationId: id,
    leadId: q.leadId ?? null,
  });
  return updated;
}

export async function rejectQuotation(tenantId, id) {
  const q = await prisma.quotation.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!q) throw NotFound("quotation not found");
  if (q.status !== "SENT") {
    throw BadRequest(`quotation is ${q.status}; only SENT can be rejected`);
  }
  return prisma.quotation.update({
    where: { id },
    data: { status: "REJECTED", rejectedAt: new Date() },
    include: QUOTATION_INCLUDE,
  });
}

// Used by the payment-webhook PAID handler.
export async function markAcceptedFromPayment(tenantId, id) {
  const q = await prisma.quotation.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!q) return null;
  if (q.status === "ACCEPTED") return q;
  return prisma.quotation.update({
    where: { id },
    data: { status: "ACCEPTED", acceptedAt: q.acceptedAt ?? new Date() },
  });
}

// Revise: marks current as REVISED, returns a new DRAFT clone with
// version++ + parentQuotationId set.
export async function reviseQuotation(tenantId, id, actorId) {
  const q = await prisma.quotation.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: { lineItems: { orderBy: { position: "asc" } } },
  });
  if (!q) throw NotFound("quotation not found");
  if (q.status !== "SENT" && q.status !== "ACCEPTED") {
    throw BadRequest(`cannot revise from ${q.status}`);
  }
  const settings = await getSettings(tenantId, [
    "quotations.number_prefix",
    "quotations.number_format",
  ]);

  for (let attempt = 0; attempt < 2; attempt++) {
    const number = await generateQuotationNumber(tenantId, settings);
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.quotation.update({
          where: { id },
          data: { status: "REVISED" },
        });
        return tx.quotation.create({
          data: {
            tenantId,
            number,
            leadId: q.leadId,
            contactId: q.contactId,
            status: "DRAFT",
            currency: q.currency,
            subtotal: q.subtotal,
            discountTotal: q.discountTotal,
            taxTotal: q.taxTotal,
            grandTotal: q.grandTotal,
            validUntil: q.validUntil,
            terms: q.terms,
            notes: q.notes,
            version: q.version + 1,
            parentQuotationId: q.id,
            createdById: actorId ?? null,
            lineItems: {
              create: q.lineItems.map((li) => ({
                productId: li.productId,
                position: li.position,
                description: li.description,
                qty: li.qty,
                unitPrice: li.unitPrice,
                discountPct: li.discountPct,
                taxRatePct: li.taxRatePct,
                lineTotal: li.lineTotal,
              })),
            },
          },
          include: QUOTATION_INCLUDE,
        });
      });
    } catch (err) {
      if (err.code === "P2002" && attempt === 0) continue;
      throw err;
    }
  }
  throw new Error("failed to revise");
}

// Cron-driven sweep: SENT quotes past validUntil flip to EXPIRED.
export async function sweepExpired(tenantId) {
  const now = new Date();
  const rows = await prisma.quotation.findMany({
    where: {
      tenantId,
      status: "SENT",
      validUntil: { lt: now },
      deletedAt: null,
    },
    select: { id: true, leadId: true },
  });
  if (!rows.length) return { expired: 0 };
  await prisma.quotation.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { status: "EXPIRED" },
  });
  for (const r of rows) {
    if (r.leadId) {
      await prisma.leadActivity.create({
        data: {
          leadId: r.leadId,
          kind: "AUTOMATION",
          data: { event: "quotation_expired", quotationId: r.id },
        },
      });
    }
  }
  return { expired: rows.length };
}

// ─── Approvals ──────────────────────────────────────────────────────

export async function requestApproval(tenantId, quotationId, _actorId) {
  const q = await prisma.quotation.findFirst({
    where: { id: quotationId, tenantId, deletedAt: null },
  });
  if (!q) throw NotFound("quotation not found");
  if (q.status !== "DRAFT") {
    throw BadRequest("only DRAFT quotations can request approval");
  }
  const existing = await prisma.quotationApproval.findFirst({
    where: { quotationId, status: "PENDING" },
  });
  if (existing) return existing;
  return prisma.quotationApproval.create({
    data: {
      tenantId,
      quotationId,
      status: "PENDING",
      thresholdAmount: q.grandTotal,
    },
  });
}

export async function decideApproval(tenantId, approvalId, decision, approverId, comment) {
  const ap = await prisma.quotationApproval.findFirst({
    where: { id: approvalId, tenantId, status: "PENDING" },
  });
  if (!ap) throw NotFound("pending approval not found");
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    throw BadRequest("decision must be APPROVED or REJECTED");
  }
  return prisma.quotationApproval.update({
    where: { id: approvalId },
    data: {
      status: decision,
      approverId,
      comment: comment ?? null,
      decidedAt: new Date(),
    },
  });
}

// ─── AI seam ───────────────────────────────────────────────────────
// Called by the AI sales agent layer when a buying signal is detected.
// Creates a DRAFT quote, marks draftedByAi, and enqueues a ManualQueueItem
// so an operator reviews before /send. Money artifacts never go out
// unattended.

export async function draftFromAiSuggestion(tenantId, { leadId, items, terms, notes }) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: { contact: true },
  });
  if (!lead) throw NotFound("lead not found");

  const quote = await createQuotation(tenantId, {
    contactId: lead.contactId,
    leadId: lead.id,
    lineItems: items,
    terms,
    notes,
    draftedByAi: true,
  });

  // Find the contact's most recent chat to enqueue a manual review.
  const chat = await prisma.chat.findFirst({
    where: { tenantId, contactId: lead.contactId },
    orderBy: { lastMessageAt: "desc" },
    include: {
      sessions: {
        where: { endedAt: null },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
  });
  if (chat?.sessions?.[0]) {
    await prisma.manualQueueItem.create({
      data: {
        chatId: chat.id,
        sessionId: chat.sessions[0].id,
        reason: "AI_QUOTATION_REVIEW",
      },
    });
  }
  return quote;
}
