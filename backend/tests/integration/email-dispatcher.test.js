// Integration test for the M11.D5 email dispatcher. Uses EMAIL_STUB so
// no real provider is hit — sent emails accumulate in an in-memory list
// inside the stub provider that we can inspect.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();
process.env.EMAIL_STUB = "true";

import { PrismaClient } from "@prisma/client";
import { getDefaultTenantId } from "../../src/shared/tenant.js";
import { maybeEmailNotification } from "../../src/modules/email/email.dispatcher.js";
import {
  getStubSentEmails,
  clearStubSentEmails,
} from "../../src/modules/email/providers/index.js";

const p = new PrismaClient();
let tid;
let adminUserIds = [];

before(async () => {
  tid = await getDefaultTenantId();
  const admins = await p.user.findMany({
    where: {
      tenantId: tid,
      role: { in: ["SUPER_ADMIN", "ADMIN"] },
      isActive: true,
    },
    select: { id: true },
  });
  adminUserIds = admins.map((u) => u.id);
});

after(async () => {
  await p.$disconnect();
});

beforeEach(() => {
  clearStubSentEmails();
});

describe("maybeEmailNotification — kind allowlist", () => {
  test("JOB_FAILED is in default allowlist → emails get sent", async () => {
    if (adminUserIds.length === 0) return;
    await maybeEmailNotification({
      tenantId: tid,
      userIds: adminUserIds,
      kind: "JOB_FAILED",
      title: "Test failure",
      body: "Test body",
      url: "/queue",
    });
    const sent = getStubSentEmails();
    assert.equal(sent.length, adminUserIds.length, "one email per admin");
    assert.match(sent[0].subject, /Test failure/);
    // Body html contains the rendered notification template.
    assert.match(sent[0].html, /Test failure/);
    assert.match(sent[0].text, /Test failure/);
  });

  test("LEAD_ASSIGNED is NOT in default allowlist → no emails sent", async () => {
    if (adminUserIds.length === 0) return;
    await maybeEmailNotification({
      tenantId: tid,
      userIds: adminUserIds,
      kind: "LEAD_ASSIGNED",
      title: "New lead",
      body: "Routine — no email",
    });
    assert.equal(getStubSentEmails().length, 0);
  });

  test("empty userIds is a no-op (no throw)", async () => {
    await maybeEmailNotification({
      tenantId: tid,
      userIds: [],
      kind: "JOB_FAILED",
      title: "x",
    });
    assert.equal(getStubSentEmails().length, 0);
  });

  test("null tenantId is a no-op (no throw)", async () => {
    await maybeEmailNotification({
      tenantId: null,
      userIds: ["whatever"],
      kind: "JOB_FAILED",
      title: "x",
    });
    assert.equal(getStubSentEmails().length, 0);
  });
});

describe("maybeEmailNotification — disabled master switch", () => {
  test("email.enabled = false → no emails sent", async () => {
    if (adminUserIds.length === 0) return;
    // Flip the setting OFF directly via prisma (skips the encryption +
    // audit-log path, which is fine for a test).
    await p.setting.upsert({
      where: { tenantId_key: { tenantId: tid, key: "email.enabled" } },
      create: { tenantId: tid, key: "email.enabled", value: false, encrypted: false },
      update: { value: false },
    });
    try {
      await maybeEmailNotification({
        tenantId: tid,
        userIds: adminUserIds,
        kind: "JOB_FAILED",
        title: "Disabled test",
      });
      assert.equal(getStubSentEmails().length, 0);
    } finally {
      await p.setting.update({
        where: { tenantId_key: { tenantId: tid, key: "email.enabled" } },
        data: { value: true },
      });
    }
  });
});

describe("maybeEmailNotification — URL absolutization", () => {
  test("relative URL is prefixed with FRONTEND_URL when set", async () => {
    if (adminUserIds.length === 0) return;
    process.env.FRONTEND_URL = "https://app.example.com";
    await maybeEmailNotification({
      tenantId: tid,
      userIds: [adminUserIds[0]],
      kind: "JOB_FAILED",
      title: "URL test",
      url: "/queue",
    });
    const sent = getStubSentEmails();
    assert.equal(sent.length, 1);
    assert.match(sent[0].html, /https:\/\/app\.example\.com\/queue/);
  });

  test("absolute URL is passed through unchanged", async () => {
    if (adminUserIds.length === 0) return;
    process.env.FRONTEND_URL = "https://app.example.com";
    await maybeEmailNotification({
      tenantId: tid,
      userIds: [adminUserIds[0]],
      kind: "JOB_FAILED",
      title: "URL passthrough",
      url: "https://other.example.com/deep/link",
    });
    const sent = getStubSentEmails();
    assert.match(sent[0].html, /other\.example\.com\/deep\/link/);
    assert.ok(!sent[0].html.includes("app.example.com/https"));
  });
});
