// Integration test for M11.C2 — public signup flow.
// Verifies:
//   - gate behavior: disabled by default; flipping the setting on the
//     oldest (operator-controlled) tenant opens signup.
//   - happy path: signup creates Tenant + SUPER_ADMIN User + full
//     scaffolding (settings, templates, pipeline+stages, channels).
//   - email collision: a second signup with the same email is 409.
//   - tokens are issued so the new user lands signed-in.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();
process.env.EMAIL_STUB = "true";

import { PrismaClient } from "@prisma/client";
import { signup, signupEnabled } from "../../src/modules/auth/auth.controller.js";

const p = new PrismaClient();
let originalSetting; // restore after the suite

async function getOldestTenantId() {
  const t = await p.tenant.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return t?.id;
}

async function setSignupEnabled(value) {
  const tid = await getOldestTenantId();
  if (!tid) throw new Error("no tenant — run seed first");
  await p.setting.upsert({
    where: { tenantId_key: { tenantId: tid, key: "tenant.signup_enabled" } },
    create: {
      tenantId: tid,
      key: "tenant.signup_enabled",
      value,
      encrypted: false,
    },
    update: { value },
  });
}

before(async () => {
  // Capture the current value so we can restore it after.
  const tid = await getOldestTenantId();
  const row = await p.setting.findUnique({
    where: { tenantId_key: { tenantId: tid, key: "tenant.signup_enabled" } },
  });
  originalSetting = row?.value ?? false;
});

after(async () => {
  // Restore the setting + clean up test tenants.
  await setSignupEnabled(originalSetting);
  // Best-effort cleanup of any tenants created by this suite. We
  // identify them by their slug prefix "c2-test-".
  await p.user.deleteMany({ where: { email: { startsWith: "c2-test-" } } });
  await p.tenant.deleteMany({ where: { slug: { startsWith: "c2-test-" } } });
  await p.$disconnect();
});

// invoke() — same controller-driving harness pattern as the
// auth-reset-verify suite. asyncHandler doesn't return its inner
// promise, so awaiting the controller directly races res.json/next.
async function invoke(controller, body) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      jsonBody: null,
      cookies: [],
      status(code) {
        res.statusCode = code;
        return res;
      },
      json(body) {
        res.jsonBody = body;
        resolve(res);
        return res;
      },
      cookie(name, value, opts) {
        res.cookies.push({ name, value, opts });
        return res;
      },
    };
    const next = (err) => (err ? reject(err) : resolve(res));
    controller({ body }, res, next);
  });
}

describe("GET /auth/signup-enabled", () => {
  test("reports false by default", async () => {
    await setSignupEnabled(false);
    const res = await invoke(signupEnabled);
    assert.equal(res.jsonBody.enabled, false);
  });

  test("reports true after the flag flips", async () => {
    await setSignupEnabled(true);
    const res = await invoke(signupEnabled);
    assert.equal(res.jsonBody.enabled, true);
  });
});

describe("POST /auth/signup — gating", () => {
  test("403 Forbidden when signup is disabled", async () => {
    await setSignupEnabled(false);
    let caught;
    try {
      await invoke(signup, {
        email: `c2-test-gated-${Date.now()}@local.test`,
        password: "abcd1234",
        fullName: "Gated User",
        orgName: "c2-test-gated-org",
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "must throw when signup disabled");
    assert.equal(caught.status, 403);
    assert.match(caught.message, /disabled/i);
  });
});

describe("POST /auth/signup — happy path (signup enabled)", () => {
  test("creates Tenant + SUPER_ADMIN + scaffolding + tokens", async () => {
    await setSignupEnabled(true);
    const email = `c2-test-hp-${Date.now()}@local.test`;
    const orgName = `c2-test-hp-org-${Date.now()}`;

    const res = await invoke(signup, {
      email,
      password: "abcd1234",
      fullName: "Happy Path",
      orgName,
    });

    assert.equal(res.statusCode, 201);
    assert.ok(res.jsonBody.accessToken, "access token issued");
    assert.equal(res.jsonBody.user.email, email);
    assert.equal(res.jsonBody.user.role, "SUPER_ADMIN");
    assert.ok(res.jsonBody.tenant.slug.startsWith("c2-test-hp-org"));

    // Refresh cookie set.
    assert.ok(res.cookies.find((c) => c.name === "sa_refresh"));

    // DB checks: tenant, user, scaffolding.
    const tenantId = res.jsonBody.tenant.id;
    const tenant = await p.tenant.findUnique({ where: { id: tenantId } });
    assert.ok(tenant);
    const user = await p.user.findUnique({ where: { email } });
    assert.equal(user.role, "SUPER_ADMIN");
    assert.equal(user.tenantId, tenantId);

    // Settings — at least the signup-enabled key is seeded.
    const settingsCount = await p.setting.count({ where: { tenantId } });
    assert.ok(settingsCount >= 50, `expected >=50 settings, got ${settingsCount}`);

    // Default pipeline + stages.
    const pipeline = await p.pipeline.findFirst({
      where: { tenantId, isDefault: true },
      include: { stages: true },
    });
    assert.ok(pipeline);
    assert.ok(pipeline.stages.length >= 7);
    // "Quotation Sent" stage must exist (M11.A wiring depends on it).
    assert.ok(pipeline.stages.find((s) => s.name === "Quotation Sent"));

    // Default channels.
    const channels = await p.channel.findMany({ where: { tenantId } });
    assert.ok(channels.find((c) => c.type === "WHATSAPP"));
    assert.ok(channels.find((c) => c.type === "WEB_CHAT"));

    // Message templates — at least the core 5.
    const templates = await p.messageTemplate.count({ where: { tenantId } });
    assert.ok(templates >= 5);

    // Test campaign should NOT be seeded for signup tenants.
    const testCampaign = await p.campaign.findFirst({
      where: { tenantId, tag: "CAMPAIGN_TEST_INTERNAL" },
    });
    assert.equal(testCampaign, null);
  });
});

describe("POST /auth/signup — email collision", () => {
  test("409 Conflict on duplicate email", async () => {
    await setSignupEnabled(true);
    const email = `c2-test-dup-${Date.now()}@local.test`;

    // First signup succeeds.
    await invoke(signup, {
      email,
      password: "abcd1234",
      fullName: "First",
      orgName: `c2-test-dup-${Date.now()}-a`,
    });

    // Second signup with same email — must reject.
    let caught;
    try {
      await invoke(signup, {
        email,
        password: "abcd1234",
        fullName: "Second",
        orgName: `c2-test-dup-${Date.now()}-b`,
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "must throw");
    assert.equal(caught.status, 409);
    assert.match(caught.message, /already exists/i);
  });
});
