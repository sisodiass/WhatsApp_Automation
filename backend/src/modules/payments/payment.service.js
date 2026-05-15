// Payment links + transactions + invoices.
//
// createPaymentLink — calls the provider factory; persists PaymentLink
//   in CREATED → flips to PENDING after we hand it off; outbound delivery
//   is enqueued via the existing outbound-dispatcher path (we create a
//   normal OUT message with the link body, same as quote_sent does).
//
// handleWebhookEvent — central reducer for webhook events from any
//   provider. Idempotent: PaymentTransaction has a unique constraint on
//   (tenantId, provider, providerPaymentId). When a PAID event lands, the
//   linked Quotation moves to ACCEPTED, the Lead moves to "Won", and the
//   PAYMENT_RECEIVED domain event fires so automations + invoice gen
//   pick up.

import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";
import { child } from "../../shared/logger.js";
import { emit, Events } from "../../shared/events.js";
import { getSettings } from "../settings/settings.service.js";
import { interpolate } from "../templates/template.service.js";
import { buildContactVars, buildStandardVars } from "../templates/variables.js";
import { enqueueOutbound } from "../queue/producers.js";
import { moveLeadStage } from "../leads/lead.service.js";
import { markAcceptedFromPayment } from "../quotations/quotation.service.js";
import { generateInvoiceNumber } from "../quotations/quotation.numbering.js";
import {
  getPaymentProvider,
  getProviderByName,
} from "./providers/index.js";
import { Kinds } from "./providers/base.js";

const log = child("payments");

const LINK_INCLUDE = {
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
  quotation: {
    select: { id: true, number: true, status: true, grandTotal: true, currency: true },
  },
  transactions: { orderBy: { createdAt: "desc" } },
};

// ─── List / read ───────────────────────────────────────────────────

export async function listPaymentLinks(tenantId, opts = {}) {
  const { status, leadId, contactId, page = 1, pageSize = 50 } = opts;
  const where = {
    tenantId,
    ...(status ? { status } : {}),
    ...(leadId ? { leadId } : {}),
    ...(contactId ? { contactId } : {}),
  };
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const [items, total] = await Promise.all([
    prisma.paymentLink.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: LINK_INCLUDE,
    }),
    prisma.paymentLink.count({ where }),
  ]);
  return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
}

export async function getPaymentLink(tenantId, id) {
  const l = await prisma.paymentLink.findFirst({
    where: { id, tenantId },
    include: LINK_INCLUDE,
  });
  if (!l) throw NotFound("payment link not found");
  return l;
}

export async function listTransactions(tenantId, opts = {}) {
  const { paymentLinkId, status, page = 1, pageSize = 50 } = opts;
  const where = {
    tenantId,
    ...(paymentLinkId ? { paymentLinkId } : {}),
    ...(status ? { status } : {}),
  };
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const [items, total] = await Promise.all([
    prisma.paymentTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.paymentTransaction.count({ where }),
  ]);
  return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
}

// ─── Create payment link ───────────────────────────────────────────

export async function createPaymentLink(tenantId, data, actorId) {
  const amount = data.amount != null ? Number(data.amount) : null;
  if (!Number.isFinite(amount) || amount <= 0) throw BadRequest("amount must be > 0");

  let contactId = data.contactId;
  let leadId = data.leadId ?? null;
  let quotationId = data.quotationId ?? null;
  let currency = data.currency;

  if (quotationId) {
    const q = await prisma.quotation.findFirst({
      where: { id: quotationId, tenantId, deletedAt: null },
    });
    if (!q) throw NotFound("quotation not found");
    contactId ||= q.contactId;
    leadId ||= q.leadId;
    currency ||= q.currency;
  }
  if (!contactId) throw BadRequest("contactId required (directly or via quotation)");
  if (!currency) {
    const settings = await getSettings(tenantId, ["payments.currency_default"]);
    currency = String(settings["payments.currency_default"] || "INR").toUpperCase();
  } else {
    currency = String(currency).toUpperCase().slice(0, 3);
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId, deletedAt: null },
  });
  if (!contact) throw NotFound("contact not found");

  const settings = await getSettings(tenantId, ["payments.link_expiry_hours"]);
  const expiryHours = Number(settings["payments.link_expiry_hours"] ?? 72);
  const expiresAt = expiryHours > 0
    ? new Date(Date.now() + expiryHours * 3600 * 1000)
    : null;

  const { provider, providerName } = await getPaymentProvider();

  let providerResp;
  try {
    providerResp = await provider.createPaymentLink({
      amount,
      currency,
      customer: contact,
      metadata: {
        referenceId: quotationId ?? leadId ?? contactId,
        description:
          data.description ||
          (quotationId ? `Payment for quotation` : "Payment"),
      },
      redirectUrl: data.redirectUrl,
      expiresAt,
    });
  } catch (err) {
    log.error("provider createPaymentLink failed", { err: err.message });
    throw BadRequest(`payment provider error: ${err.message}`);
  }

  const link = await prisma.paymentLink.create({
    data: {
      tenantId,
      provider: providerName,
      providerLinkId: providerResp.providerLinkId,
      quotationId,
      leadId,
      contactId,
      amount: new Prisma.Decimal(amount),
      currency,
      status: "PENDING",
      shortUrl: providerResp.shortUrl ?? null,
      redirectUrl: data.redirectUrl ?? null,
      expiresAt,
      metadata: data.metadata ?? null,
      createdById: actorId ?? null,
    },
    include: LINK_INCLUDE,
  });

  // Dispatch link via chat if a chat exists for the contact.
  await dispatchPaymentLinkToCustomer(tenantId, link).catch((err) =>
    log.warn("payment-link dispatch failed", { id: link.id, err: err.message }),
  );

  return link;
}

async function dispatchPaymentLinkToCustomer(tenantId, link) {
  const contact = await prisma.contact.findUnique({
    where: { id: link.contactId },
    include: {
      chats: {
        take: 1,
        orderBy: { lastMessageAt: "desc" },
      },
    },
  });
  const chat = contact?.chats?.[0];
  if (!chat) return; // operator can resend via UI later

  const tpl = await prisma.messageTemplate.findFirst({
    where: { tenantId, name: "payment_link", isActive: true },
  });
  const vars = {
    ...buildStandardVars(),
    ...buildContactVars(contact),
    currency: link.currency,
    amount: String(link.amount),
    payment_url: link.shortUrl || "",
  };
  const body = tpl
    ? interpolate(tpl.content, vars)
    : `Please pay ${link.currency} ${link.amount}: ${link.shortUrl || "(link generation failed)"}`;

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

  if (link.leadId) {
    await prisma.leadActivity.create({
      data: {
        leadId: link.leadId,
        kind: "MESSAGE",
        messageId: msg.id,
        data: { event: "payment_link_sent", paymentLinkId: link.id },
      },
    });
  }
  await enqueueOutbound(msg.id);
}

// ─── Cancel + refund ───────────────────────────────────────────────

export async function cancelPaymentLink(tenantId, id) {
  const link = await prisma.paymentLink.findFirst({ where: { id, tenantId } });
  if (!link) throw NotFound("payment link not found");
  if (link.status === "PAID" || link.status === "REFUNDED") {
    throw BadRequest(`cannot cancel a ${link.status} link`);
  }
  return prisma.paymentLink.update({
    where: { id },
    data: { status: "CANCELLED" },
    include: LINK_INCLUDE,
  });
}

export async function refundPaymentLink(tenantId, id, { amount, reason } = {}) {
  const link = await prisma.paymentLink.findFirst({
    where: { id, tenantId },
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!link) throw NotFound("payment link not found");
  if (link.status !== "PAID") throw BadRequest("only PAID links can be refunded");
  const txn = link.transactions[0];
  if (!txn) throw BadRequest("no captured transaction to refund");

  const provider = await getProviderByName(link.provider);
  const r = await provider.refund({
    providerPaymentId: txn.providerPaymentId,
    amount: amount ?? Number(link.amount),
    reason,
  });

  // Persist the refund as a new PaymentTransaction row.
  await prisma.paymentTransaction.create({
    data: {
      tenantId,
      paymentLinkId: link.id,
      provider: link.provider,
      providerPaymentId: r.refundId,
      status: "REFUNDED",
      amount: new Prisma.Decimal(amount ?? Number(link.amount)),
      currency: link.currency,
      raw: r.raw ?? {},
    },
  }).catch((err) => {
    // Idempotency: replay-safe.
    if (err.code !== "P2002") throw err;
  });

  return prisma.paymentLink.update({
    where: { id },
    data: { status: "REFUNDED" },
    include: LINK_INCLUDE,
  });
}

// ─── Webhook reducer ───────────────────────────────────────────────

export async function handleWebhookEvent(tenantId, providerName, event) {
  log.info("webhook event", {
    provider: providerName,
    kind: event.kind,
    linkId: event.providerLinkId,
    paymentId: event.providerPaymentId,
  });

  if (event.kind === Kinds.UNKNOWN) return { ignored: true };

  // Resolve the linked PaymentLink row by provider_link_id when present.
  let link = null;
  if (event.providerLinkId) {
    link = await prisma.paymentLink.findFirst({
      where: {
        tenantId,
        provider: providerName,
        providerLinkId: event.providerLinkId,
      },
    });
  }
  // Some Stripe events don't carry a payment_link reference (e.g. raw
  // charge.succeeded). Use the providerPaymentId as a secondary lookup.
  if (!link && event.providerPaymentId) {
    const existingTxn = await prisma.paymentTransaction.findFirst({
      where: {
        tenantId,
        provider: providerName,
        providerPaymentId: event.providerPaymentId,
      },
    });
    if (existingTxn?.paymentLinkId) {
      link = await prisma.paymentLink.findUnique({
        where: { id: existingTxn.paymentLinkId },
      });
    }
  }
  if (!link) {
    log.warn("webhook for unknown link", {
      providerLinkId: event.providerLinkId,
      providerPaymentId: event.providerPaymentId,
    });
    return { ignored: true, reason: "unknown_link" };
  }

  // Branch by event kind.
  if (event.kind === Kinds.PAYMENT_CAPTURED || event.kind === Kinds.LINK_PAID) {
    return handlePaidEvent(tenantId, link, event);
  }
  if (event.kind === Kinds.PAYMENT_FAILED) {
    return handleFailedEvent(tenantId, link, event);
  }
  if (event.kind === Kinds.LINK_EXPIRED) {
    await prisma.paymentLink.updateMany({
      where: { id: link.id, status: { in: ["CREATED", "PENDING"] } },
      data: { status: "EXPIRED" },
    });
    return { ok: true };
  }
  if (event.kind === Kinds.LINK_CANCELLED) {
    await prisma.paymentLink.updateMany({
      where: { id: link.id, status: { in: ["CREATED", "PENDING"] } },
      data: { status: "CANCELLED" },
    });
    return { ok: true };
  }
  if (event.kind === Kinds.REFUND_PROCESSED) {
    // Refunds we initiated also surface as webhooks; idempotent insert.
    if (event.providerPaymentId) {
      await prisma.paymentTransaction
        .create({
          data: {
            tenantId,
            paymentLinkId: link.id,
            provider: providerName,
            providerPaymentId: event.providerPaymentId,
            status: "REFUNDED",
            amount: event.amount
              ? new Prisma.Decimal(event.amount)
              : new Prisma.Decimal(link.amount),
            currency: event.currency || link.currency,
            raw: event.raw,
          },
        })
        .catch((err) => {
          if (err.code !== "P2002") throw err;
        });
      await prisma.paymentLink.update({
        where: { id: link.id },
        data: { status: "REFUNDED" },
      });
    }
    return { ok: true };
  }
  return { ignored: true };
}

async function handlePaidEvent(tenantId, link, event) {
  if (!event.providerPaymentId) {
    log.warn("paid event missing providerPaymentId", { linkId: link.id });
    return { ignored: true, reason: "no_payment_id" };
  }

  // Idempotent insert: unique on (tenant, provider, providerPaymentId).
  const inserted = await prisma.paymentTransaction
    .create({
      data: {
        tenantId,
        paymentLinkId: link.id,
        provider: link.provider,
        providerPaymentId: event.providerPaymentId,
        providerOrderId: event.providerOrderId ?? null,
        status: "CAPTURED",
        amount: event.amount
          ? new Prisma.Decimal(event.amount)
          : new Prisma.Decimal(link.amount),
        currency: event.currency || link.currency,
        method: event.method ?? null,
        raw: event.raw,
        capturedAt: event.capturedAt ?? new Date(),
      },
    })
    .catch((err) => {
      if (err.code === "P2002") return null; // replay — already recorded
      throw err;
    });

  if (!inserted) {
    log.info("webhook replay — already processed", {
      providerPaymentId: event.providerPaymentId,
    });
    return { ok: true, replay: true };
  }

  await prisma.paymentLink.update({
    where: { id: link.id },
    data: { status: "PAID", paidAt: new Date() },
  });

  // Quotation → ACCEPTED.
  if (link.quotationId) {
    await markAcceptedFromPayment(tenantId, link.quotationId);
  }

  // Lead → "Won". moveLeadIfDifferent inlined here so we don't import
  // quotation.service circularly.
  if (link.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: link.leadId } });
    if (lead) {
      const stage = await prisma.stage.findFirst({
        where: {
          pipelineId: lead.pipelineId,
          name: { equals: "Won", mode: "insensitive" },
        },
      });
      if (stage && stage.id !== lead.stageId) {
        await moveLeadStage(tenantId, link.leadId, stage.id, null).catch((err) =>
          log.warn("lead → Won failed", { err: err.message }),
        );
      }
    }
  }

  // Send confirmation message to customer if a chat exists.
  await sendPaidConfirmation(tenantId, link, event).catch((err) =>
    log.warn("paid confirmation send failed", { linkId: link.id, err: err.message }),
  );

  // Invoice generation (async) — number is generated lazily on demand by
  // calling code; for now we just create the row.
  await maybeCreateInvoice(tenantId, link, event).catch((err) =>
    log.warn("invoice create failed", { linkId: link.id, err: err.message }),
  );

  // Domain event for automation triggers.
  emit(Events.PAYMENT_RECEIVED, {
    tenantId,
    leadId: link.leadId ?? null,
    paymentLinkId: link.id,
    quotationId: link.quotationId ?? null,
    amount: Number(event.amount ?? link.amount),
    currency: event.currency || link.currency,
  });

  return { ok: true };
}

async function handleFailedEvent(tenantId, link, event) {
  if (event.providerPaymentId) {
    await prisma.paymentTransaction
      .create({
        data: {
          tenantId,
          paymentLinkId: link.id,
          provider: link.provider,
          providerPaymentId: event.providerPaymentId,
          status: "FAILED",
          amount: event.amount
            ? new Prisma.Decimal(event.amount)
            : new Prisma.Decimal(link.amount),
          currency: event.currency || link.currency,
          method: event.method ?? null,
          raw: event.raw,
        },
      })
      .catch((err) => {
        if (err.code !== "P2002") throw err;
      });
  }
  await prisma.paymentLink.update({
    where: { id: link.id },
    data: { status: "FAILED" },
  });
  return { ok: true };
}

async function sendPaidConfirmation(tenantId, link, event) {
  const contact = await prisma.contact.findUnique({
    where: { id: link.contactId },
    include: { chats: { take: 1, orderBy: { lastMessageAt: "desc" } } },
  });
  const chat = contact?.chats?.[0];
  if (!chat) return;
  const tpl = await prisma.messageTemplate.findFirst({
    where: { tenantId, name: "payment_confirmed", isActive: true },
  });
  const vars = {
    ...buildStandardVars(),
    ...buildContactVars(contact),
    currency: event.currency || link.currency,
    amount: String(event.amount ?? link.amount),
    txn_id: event.providerPaymentId || "",
  };
  const body = tpl
    ? interpolate(tpl.content, vars)
    : `Payment received. Thank you!`;
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
  await enqueueOutbound(msg.id);
}

async function maybeCreateInvoice(tenantId, link, event) {
  // Only create if we have a quotation; otherwise the operator can do it.
  if (!link.quotationId) return;
  const existing = await prisma.invoice.findFirst({
    where: { tenantId, quotationId: link.quotationId, paymentLinkId: link.id },
  });
  if (existing) return;
  const settings = await getSettings(tenantId, [
    "invoices.number_prefix",
    "invoices.number_format",
  ]);
  for (let attempt = 0; attempt < 2; attempt++) {
    const number = await generateInvoiceNumber(tenantId, settings);
    try {
      return await prisma.invoice.create({
        data: {
          tenantId,
          number,
          quotationId: link.quotationId,
          paymentLinkId: link.id,
          amount: event.amount
            ? new Prisma.Decimal(event.amount)
            : new Prisma.Decimal(link.amount),
          currency: event.currency || link.currency,
        },
      });
    } catch (err) {
      if (err.code === "P2002" && attempt === 0) continue;
      throw err;
    }
  }
}

// ─── Invoices ──────────────────────────────────────────────────────

export async function listInvoices(tenantId, opts = {}) {
  const { page = 1, pageSize = 50, quotationId } = opts;
  const where = {
    tenantId,
    ...(quotationId ? { quotationId } : {}),
  };
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const [items, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        quotation: { select: { id: true, number: true, contactId: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);
  return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
}
