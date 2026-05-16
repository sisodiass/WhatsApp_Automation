// Integration test for Contact.notifyName persistence on inbound.
// notifyName captures the WhatsApp push-name on EVERY inbound (not
// just first contact) — verifies that the second inbound from the
// same contact with a different push-name updates the field, and
// that firstName/lastName remain untouched (operator-edited values
// must not be clobbered by later inbounds).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { getDefaultTenantId } from "../../src/shared/tenant.js";
import { handleInbound } from "../../src/modules/sessions/session.service.js";
import { findCampaignByMessageBody } from "../../src/modules/campaigns/campaign.service.js";
import { closeAllQueues } from "../../src/shared/queue.js";
import { redis } from "../../src/shared/redis.js";

const p = new PrismaClient();
let tid;
let testCampaign;

before(async () => {
  tid = await getDefaultTenantId();
  // Use the seeded internal test campaign so the inbound flow doesn't
  // fall through to "no campaign" handling.
  testCampaign = await findCampaignByMessageBody(tid, "CAMPAIGN_TEST_INTERNAL");
});

after(async () => {
  // handleInbound enqueues BullMQ jobs which hold Redis connections
  // open via ioredis. Close them explicitly so node can exit before
  // the test runner's 60s timeout.
  await closeAllQueues().catch(() => {});
  await redis.quit().catch(() => {});
  await p.$disconnect();
});

async function cleanupByJid(jid) {
  const chat = await p.chat.findFirst({ where: { tenantId: tid, phone: jid } });
  if (!chat) return;
  // Order: sessions → messages → chat → leads → contact
  const sessions = await p.chatSession.findMany({ where: { chatId: chat.id } });
  for (const s of sessions) {
    await p.message.deleteMany({ where: { sessionId: s.id } });
  }
  await p.chatSession.deleteMany({ where: { chatId: chat.id } });
  await p.note.deleteMany({ where: { chatId: chat.id } });
  await p.chatTag.deleteMany({ where: { chatId: chat.id } });
  await p.manualQueueItem.deleteMany({ where: { chatId: chat.id } });
  const contactId = chat.contactId;
  await p.chat.delete({ where: { id: chat.id } });
  if (contactId) {
    await p.leadActivity.deleteMany({ where: { lead: { contactId } } });
    await p.leadMemory.deleteMany({ where: { lead: { contactId } } });
    await p.lead.deleteMany({ where: { contactId } });
    await p.contact.delete({ where: { id: contactId } });
  }
}

describe("Contact.notifyName — captured on every inbound", () => {
  test("first inbound stores notifyName + firstName/lastName from push-name", async () => {
    const jid = `169-${Date.now()}@lid`;
    try {
      await handleInbound({
        tenantId: tid,
        from: jid,
        contactPhone: null, // LID with no resolved phone
        body: "CAMPAIGN_TEST_INTERNAL hello",
        waMessageId: `wamid-1-${Date.now()}`,
        displayName: "Priya Sharma",
      });
      const chat = await p.chat.findFirst({ where: { tenantId: tid, phone: jid } });
      assert.ok(chat, "chat row created");
      const contact = await p.contact.findUnique({ where: { id: chat.contactId } });
      assert.ok(contact, "contact row created");
      // notifyName captured.
      assert.equal(contact.notifyName, "Priya Sharma");
      // firstName/lastName populated via splitDisplayName at first contact.
      assert.equal(contact.firstName, "Priya");
      assert.equal(contact.lastName, "Sharma");
    } finally {
      await cleanupByJid(jid);
    }
  });

  test("second inbound refreshes notifyName when push-name changes — but does NOT touch firstName/lastName", async () => {
    const jid = `169r-${Date.now()}@lid`;
    try {
      // First inbound — establishes the contact.
      await handleInbound({
        tenantId: tid,
        from: jid,
        contactPhone: null,
        body: "CAMPAIGN_TEST_INTERNAL hello",
        waMessageId: `wamid-r1-${Date.now()}`,
        displayName: "Original Name",
      });
      // Operator edits firstName/lastName (simulating manual UI edit).
      const chat = await p.chat.findFirst({ where: { tenantId: tid, phone: jid } });
      await p.contact.update({
        where: { id: chat.contactId },
        data: { firstName: "Operator-Set", lastName: "Manually" },
      });

      // Second inbound — push-name has changed.
      await handleInbound({
        tenantId: tid,
        from: jid,
        contactPhone: null,
        body: "follow up",
        waMessageId: `wamid-r2-${Date.now()}`,
        displayName: "Updated Push Name",
      });

      const refreshed = await p.contact.findUnique({ where: { id: chat.contactId } });
      assert.equal(
        refreshed.notifyName,
        "Updated Push Name",
        "notifyName must reflect the latest push-name",
      );
      // Crucial: operator's edits stay intact.
      assert.equal(refreshed.firstName, "Operator-Set");
      assert.equal(refreshed.lastName, "Manually");
    } finally {
      await cleanupByJid(jid);
    }
  });

  test("inbound with no push-name leaves notifyName intact", async () => {
    const jid = `169n-${Date.now()}@lid`;
    try {
      await handleInbound({
        tenantId: tid,
        from: jid,
        contactPhone: null,
        body: "CAMPAIGN_TEST_INTERNAL hello",
        waMessageId: `wamid-n1-${Date.now()}`,
        displayName: "Original",
      });
      const chat = await p.chat.findFirst({ where: { tenantId: tid, phone: jid } });
      const before = await p.contact.findUnique({ where: { id: chat.contactId } });
      assert.equal(before.notifyName, "Original");

      // Second inbound — push-name absent (some message types don't
      // surface notifyName). notifyName must NOT be overwritten with null.
      await handleInbound({
        tenantId: tid,
        from: jid,
        contactPhone: null,
        body: "another message",
        waMessageId: `wamid-n2-${Date.now()}`,
        displayName: null,
      });
      const after = await p.contact.findUnique({ where: { id: chat.contactId } });
      assert.equal(after.notifyName, "Original");
    } finally {
      await cleanupByJid(jid);
    }
  });
});
