// Integration test for the M11.B2 AI-to-quote bridge end-to-end:
//   scoreLead → HOT+PURCHASE_INTENT detected → quotation.draftFromAiSuggestion
//   → DRAFT quote with draftedByAi=true → ManualQueueItem(AI_QUOTATION_REVIEW)
//
// Uses AI_STUB so we don't burn real tokens. Builds a fresh fixture per
// test and cleans it up; safe to run repeatedly against the dev DB.
// Skipped automatically if the DB isn't reachable.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();
process.env.AI_STUB = "true";

import { PrismaClient } from "@prisma/client";
import { getDefaultTenantId } from "../../src/shared/tenant.js";
import { scoreLead } from "../../src/modules/ai/scoring.service.js";

const p = new PrismaClient();
let tid;

before(async () => {
  tid = await getDefaultTenantId();
});

after(async () => {
  await p.$disconnect();
});

async function makeLeadWithMessage(text) {
  const phone = `intg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const contact = await p.contact.create({
    data: { tenantId: tid, mobile: phone, firstName: "Intg", lastName: "Bridge" },
  });
  const pipeline = await p.pipeline.findFirst({
    where: { tenantId: tid, isDefault: true },
  });
  const stage = await p.stage.findFirst({
    where: { pipelineId: pipeline.id },
    orderBy: { order: "asc" },
  });
  const lead = await p.lead.create({
    data: { tenantId: tid, contactId: contact.id, pipelineId: pipeline.id, stageId: stage.id },
  });
  const chat = await p.chat.create({
    data: { tenantId: tid, phone, contactId: contact.id, displayName: "Intg Bridge" },
  });
  const session = await p.chatSession.create({
    data: { chatId: chat.id, state: "ACTIVE", mode: "AI" },
  });
  await p.message.create({
    data: { sessionId: session.id, direction: "IN", source: "CUSTOMER", body: text },
  });
  return { contact, lead, chat, session };
}

async function cleanup({ contact, lead, chat, session }) {
  // Order matters — children before parents to satisfy FK constraints.
  const quotes = await p.quotation.findMany({ where: { leadId: lead.id }, select: { id: true } });
  if (quotes.length) {
    await p.quotationLineItem.deleteMany({
      where: { quotationId: { in: quotes.map((q) => q.id) } },
    });
    await p.quotation.deleteMany({ where: { id: { in: quotes.map((q) => q.id) } } });
  }
  await p.manualQueueItem.deleteMany({ where: { sessionId: session.id } });
  await p.message.deleteMany({ where: { sessionId: session.id } });
  await p.chatSession.delete({ where: { id: session.id } });
  await p.chat.delete({ where: { id: chat.id } });
  await p.leadActivity.deleteMany({ where: { leadId: lead.id } });
  await p.leadMemory.deleteMany({ where: { leadId: lead.id } });
  await p.lead.delete({ where: { id: lead.id } });
  await p.contact.delete({ where: { id: contact.id } });
}

describe("AI-to-quote bridge — HOT + PURCHASE_INTENT path", () => {
  test("auto-drafts a quotation and creates a manual queue item", async () => {
    const fix = await makeLeadWithMessage("I want to buy a Pro plan today");
    try {
      const result = await scoreLead(tid, fix.lead.id, null);

      // Score + intent fields populated by the stub provider.
      assert.equal(result.score, "HOT");
      assert.equal(result.intent, "PURCHASE_INTENT");
      assert.ok(Array.isArray(result.buyingSignals));
      assert.ok(result.buyingSignals.length > 0);
      assert.ok(result.autoDraftedQuotationId, "expected an auto-drafted quotation id");

      // Quote exists with the right shape.
      const quote = await p.quotation.findUnique({
        where: { id: result.autoDraftedQuotationId },
        include: { lineItems: true },
      });
      assert.ok(quote, "quote should exist in DB");
      assert.equal(quote.status, "DRAFT");
      assert.equal(quote.draftedByAi, true);
      assert.equal(quote.leadId, fix.lead.id);
      assert.equal(quote.lineItems.length, 1);
      // Line description references the interested_product from stub memory.
      assert.match(quote.lineItems[0].description, /WhatsApp CRM/);

      // Manual queue item with the M11 review reason.
      const item = await p.manualQueueItem.findFirst({
        where: { sessionId: fix.session.id, reason: "AI_QUOTATION_REVIEW" },
      });
      assert.ok(item, "manual queue item with AI_QUOTATION_REVIEW reason should exist");

      // LeadMemory should now carry last_intent + buying_signals.
      const mem = await p.leadMemory.findUnique({ where: { leadId: fix.lead.id } });
      assert.equal(mem.memory.last_intent, "PURCHASE_INTENT");
      assert.ok(Array.isArray(mem.memory.buying_signals));
      assert.ok(mem.memory.buying_signals.includes("budget_mentioned"));
    } finally {
      await cleanup(fix);
    }
  });

  test("re-scoring is idempotent — does not create a second draft", async () => {
    const fix = await makeLeadWithMessage("I want to buy a Pro plan today");
    try {
      const first = await scoreLead(tid, fix.lead.id, null);
      assert.ok(first.autoDraftedQuotationId);

      const second = await scoreLead(tid, fix.lead.id, null);
      assert.equal(
        second.autoDraftedQuotationId,
        null,
        "second score with an existing DRAFT must not create another",
      );

      // Only one quote exists.
      const quotes = await p.quotation.findMany({ where: { leadId: fix.lead.id } });
      assert.equal(quotes.length, 1);
    } finally {
      await cleanup(fix);
    }
  });

  test("intent + buyingSignals persist into LeadMemory even when bridge skips", async () => {
    // Pre-create an existing DRAFT quote so the bridge skips, but the
    // memory persistence path must still fire — operators rely on the
    // intent badge in the lead detail UI.
    const fix = await makeLeadWithMessage("I want to buy a Pro plan today");
    try {
      // Drop a stub quote first so the bridge sees it and skips.
      await p.quotation.create({
        data: {
          tenantId: tid,
          number: `QTN-TEST-${Date.now()}`,
          contactId: fix.contact.id,
          leadId: fix.lead.id,
          status: "DRAFT",
          currency: "INR",
          subtotal: "0",
          discountTotal: "0",
          taxTotal: "0",
          grandTotal: "0",
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const result = await scoreLead(tid, fix.lead.id, null);
      assert.equal(result.autoDraftedQuotationId, null);
      assert.equal(result.intent, "PURCHASE_INTENT");

      const mem = await p.leadMemory.findUnique({ where: { leadId: fix.lead.id } });
      assert.equal(mem.memory.last_intent, "PURCHASE_INTENT");
    } finally {
      await cleanup(fix);
    }
  });
});
