// M11.C3a — billing foundation tests.
// - Default plans are seeded.
// - listActivePlans hides the operator-only plan.
// - ensureSubscription is idempotent + assigns the right plan.
// - provisionTenant auto-creates a Free subscription for sign-up tenants
//   and an Operator subscription for the default tenant.
// - Cross-tenant: tenant A's subscription is invisible to tenant B's
//   getSubscription call (regression test for C.4).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_PLANS,
  ensureSubscription,
  getPlanBySlug,
  getSubscription,
  listActivePlans,
  seedDefaultPlans,
} from "../../src/modules/billing/billing.service.js";
import { provisionTenant } from "../../src/modules/tenants/tenant-provisioning.service.js";

const p = new PrismaClient();
const fixtureTenantIds = [];

before(async () => {
  await seedDefaultPlans();
});

after(async () => {
  for (const id of fixtureTenantIds) {
    await p.tenant.delete({ where: { id } }).catch(() => {});
  }
  await p.$disconnect();
});

async function makeTenant(slugPrefix) {
  const t = await p.tenant.create({
    data: {
      slug: `${slugPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: slugPrefix,
    },
  });
  fixtureTenantIds.push(t.id);
  return t;
}

describe("Plan catalog", () => {
  test("seedDefaultPlans is idempotent", async () => {
    const before = await p.plan.count();
    await seedDefaultPlans();
    const after = await p.plan.count();
    assert.equal(after, before, "re-seed must not create duplicate plans");
    assert.ok(after >= DEFAULT_PLANS.length);
  });

  test("listActivePlans returns active rows in displayOrder, hides the operator plan", async () => {
    const plans = await listActivePlans();
    const slugs = plans.map((p) => p.slug);
    assert.ok(slugs.includes("free"));
    assert.ok(slugs.includes("starter"));
    assert.ok(slugs.includes("pro"));
    assert.ok(slugs.includes("enterprise"));
    assert.ok(!slugs.includes("operator"), "operator plan must be hidden from listActivePlans");
    // displayOrder ascending
    for (let i = 1; i < plans.length; i++) {
      assert.ok(plans[i - 1].displayOrder <= plans[i].displayOrder);
    }
  });

  test("free plan has restrictive limits, pro plan more permissive", async () => {
    const free = await getPlanBySlug("free");
    const pro = await getPlanBySlug("pro");
    assert.ok(free.limits.messages_per_month < pro.limits.messages_per_month);
    assert.ok(free.limits.contacts_max < (pro.limits.contacts_max ?? Infinity));
  });
});

describe("ensureSubscription + getSubscription", () => {
  test("creates a Free subscription when missing", async () => {
    const t = await makeTenant("c3a-fresh");
    const sub = await ensureSubscription(t.id);
    assert.equal(sub.plan.slug, "free");
    assert.equal(sub.status, "ACTIVE");
    assert.equal(sub.tenantId, t.id);
  });

  test("idempotent — second call returns the same subscription", async () => {
    const t = await makeTenant("c3a-ido");
    const a = await ensureSubscription(t.id);
    const b = await ensureSubscription(t.id);
    assert.equal(a.id, b.id);
  });

  test("respects defaultPlanSlug override (e.g. 'operator')", async () => {
    const t = await makeTenant("c3a-op");
    const sub = await ensureSubscription(t.id, { defaultPlanSlug: "operator" });
    assert.equal(sub.plan.slug, "operator");
  });

  test("getSubscription auto-provisions if a tenant somehow has none", async () => {
    const t = await makeTenant("c3a-orphan");
    // Skip ensureSubscription on purpose — simulate a legacy tenant.
    const sub = await getSubscription(t.id);
    assert.equal(sub.plan.slug, "free");
  });
});

describe("provisionTenant wires Subscription correctly", () => {
  test("sign-up flow (default): tenant gets free plan", async () => {
    const t = await makeTenant("c3a-prov");
    await provisionTenant(t.id, { includeTestCampaign: false });
    const sub = await getSubscription(t.id);
    assert.equal(sub.plan.slug, "free");
  });

  test("seed flow (operator): tenant gets operator plan when subscriptionSlug overrides", async () => {
    const t = await makeTenant("c3a-prov-op");
    await provisionTenant(t.id, {
      includeTestCampaign: false,
      subscriptionSlug: "operator",
    });
    const sub = await getSubscription(t.id);
    assert.equal(sub.plan.slug, "operator");
  });
});

describe("Cross-tenant isolation (regression for C.4)", () => {
  test("each tenant only sees its own subscription", async () => {
    const tA = await makeTenant("c3a-iso-a");
    const tB = await makeTenant("c3a-iso-b");
    await ensureSubscription(tA.id, { defaultPlanSlug: "free" });
    await ensureSubscription(tB.id, { defaultPlanSlug: "pro" });

    const subA = await getSubscription(tA.id);
    const subB = await getSubscription(tB.id);
    assert.equal(subA.tenantId, tA.id);
    assert.equal(subB.tenantId, tB.id);
    assert.equal(subA.plan.slug, "free");
    assert.equal(subB.plan.slug, "pro");
    assert.notEqual(subA.id, subB.id);
  });
});
