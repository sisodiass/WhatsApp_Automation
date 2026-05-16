// Integration tests for M11.D3 — terminal job failure notifications
// and payment-webhook failure notifications. Builds Prisma fixtures
// directly; doesn't actually run BullMQ.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { getDefaultTenantId } from "../../src/shared/tenant.js";
import {
  notifyOnTerminalJobFailure,
  tenantIdFromMessageId,
} from "../../src/shared/job-failure-alerts.js";
import { emitWebhookFailureAlert } from "../../src/shared/payment-webhook-alerts.js";

const p = new PrismaClient();
let tid;
let adminUserIds = [];

before(async () => {
  tid = await getDefaultTenantId();
  // Capture existing admin user ids so we can assert delta after the helper.
  const admins = await p.user.findMany({
    where: { tenantId: tid, role: { in: ["SUPER_ADMIN", "ADMIN"] }, isActive: true },
    select: { id: true },
  });
  adminUserIds = admins.map((u) => u.id);
});

after(async () => {
  await p.$disconnect();
});

// Helper: build a fake BullMQ job object with the minimum surface the
// helper reads (id, queueName, data, attemptsMade, opts.attempts).
function fakeJob({ queueName, data, attemptsMade, attempts }) {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    queueName,
    data,
    attemptsMade,
    opts: { attempts },
  };
}

describe("notifyOnTerminalJobFailure", () => {
  test("only fires on the LAST failed attempt", async () => {
    const before = await p.notification.count({
      where: { tenantId: tid, kind: "JOB_FAILED" },
    });
    // attemptsMade=2 / attempts=5 → still retrying, no notification.
    await notifyOnTerminalJobFailure(
      fakeJob({ queueName: "outgoing-messages", data: {}, attemptsMade: 2, attempts: 5 }),
      new Error("transient socket error"),
      { descriptor: "Outbound message delivery", resolveTenantId: async () => tid },
    );
    const after = await p.notification.count({
      where: { tenantId: tid, kind: "JOB_FAILED" },
    });
    assert.equal(after, before, "non-terminal failure must not notify");
  });

  test("creates a Notification per admin user on terminal failure", async () => {
    if (adminUserIds.length === 0) {
      // No admins in this tenant — skip (seed should have created one).
      return;
    }
    const before = await p.notification.count({
      where: { tenantId: tid, kind: "JOB_FAILED" },
    });
    await notifyOnTerminalJobFailure(
      fakeJob({ queueName: "outgoing-messages", data: {}, attemptsMade: 5, attempts: 5 }),
      new Error("WhatsApp send failed: AUTH_FAILURE"),
      { descriptor: "Outbound message delivery", resolveTenantId: async () => tid },
    );
    const after = await p.notification.count({
      where: { tenantId: tid, kind: "JOB_FAILED" },
    });
    assert.equal(
      after - before,
      adminUserIds.length,
      "one notification per admin user",
    );

    // Cleanup — drop the rows we just made so the count check works on re-run.
    await p.notification.deleteMany({
      where: { tenantId: tid, kind: "JOB_FAILED", body: { contains: "AUTH_FAILURE" } },
    });
  });

  test("missing tenantId resolver silently no-ops (no throw)", async () => {
    // Helper must never throw — that would compound the original failure.
    await assert.doesNotReject(async () => {
      await notifyOnTerminalJobFailure(
        fakeJob({ queueName: "outgoing-messages", data: {}, attemptsMade: 5, attempts: 5 }),
        new Error("any"),
        { descriptor: "Outbound", resolveTenantId: async () => null },
      );
    });
  });

  test("resolver throwing is swallowed", async () => {
    await assert.doesNotReject(async () => {
      await notifyOnTerminalJobFailure(
        fakeJob({ queueName: "outgoing-messages", data: {}, attemptsMade: 5, attempts: 5 }),
        new Error("any"),
        {
          descriptor: "Outbound",
          resolveTenantId: async () => {
            throw new Error("FK lookup failed");
          },
        },
      );
    });
  });

  test("null job is a no-op", async () => {
    await assert.doesNotReject(async () => {
      await notifyOnTerminalJobFailure(null, new Error("any"), {
        descriptor: "x",
        resolveTenantId: async () => tid,
      });
    });
  });
});

describe("tenantIdFromMessageId resolver", () => {
  test("resolves through message → session → chat", async () => {
    const phone = `df-${Date.now()}`;
    const contact = await p.contact.create({
      data: { tenantId: tid, mobile: phone, firstName: "DF", lastName: "Tenant" },
    });
    const chat = await p.chat.create({
      data: { tenantId: tid, phone, contactId: contact.id, displayName: "DF Tenant" },
    });
    const session = await p.chatSession.create({
      data: { chatId: chat.id, state: "ACTIVE", mode: "AI" },
    });
    const msg = await p.message.create({
      data: { sessionId: session.id, direction: "IN", source: "CUSTOMER", body: "hi" },
    });
    try {
      const resolved = await tenantIdFromMessageId(msg.id);
      assert.equal(resolved, tid);
    } finally {
      await p.message.delete({ where: { id: msg.id } });
      await p.chatSession.delete({ where: { id: session.id } });
      await p.chat.delete({ where: { id: chat.id } });
      await p.contact.delete({ where: { id: contact.id } });
    }
  });

  test("unknown messageId returns null (no throw)", async () => {
    const v = await tenantIdFromMessageId("missing-id-that-does-not-exist");
    assert.equal(v, null);
  });

  test("null/undefined returns null", async () => {
    assert.equal(await tenantIdFromMessageId(null), null);
    assert.equal(await tenantIdFromMessageId(undefined), null);
  });
});

describe("emitWebhookFailureAlert", () => {
  test("creates WEBHOOK_FAILED notifications for admin users", async () => {
    if (adminUserIds.length === 0) return;
    const before = await p.notification.count({
      where: { tenantId: tid, kind: "WEBHOOK_FAILED" },
    });
    await emitWebhookFailureAlert({
      tenantId: tid,
      provider: "RAZORPAY",
      event: { type: "payment.captured", providerPaymentId: "pay_test_xyz" },
      err: new Error("FK violation on payment_transactions.payment_link_id"),
    });
    const after = await p.notification.count({
      where: { tenantId: tid, kind: "WEBHOOK_FAILED" },
    });
    assert.equal(after - before, adminUserIds.length);
    // Body carries the actionable detail for ops.
    const sample = await p.notification.findFirst({
      where: { tenantId: tid, kind: "WEBHOOK_FAILED" },
      orderBy: { createdAt: "desc" },
    });
    assert.match(sample.body, /RAZORPAY/);
    assert.match(sample.body, /payment.captured/);
    assert.match(sample.body, /pay_test_xyz/);
    assert.match(sample.body, /Gateway will retry/);

    // Cleanup
    await p.notification.deleteMany({
      where: {
        tenantId: tid,
        kind: "WEBHOOK_FAILED",
        body: { contains: "pay_test_xyz" },
      },
    });
  });

  test("missing tenantId no-ops", async () => {
    await assert.doesNotReject(async () => {
      await emitWebhookFailureAlert({
        tenantId: null,
        provider: "STRIPE",
        event: {},
        err: new Error("x"),
      });
    });
  });
});
