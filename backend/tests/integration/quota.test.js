// M11.C3c — plan quota enforcement tests.
//
// Covers:
//   - getCurrentUsage returns counts + limits per quota key
//   - assertQuota throws QuotaExceeded with the right shape when over
//   - assertQuota allows when limit is null (unlimited)
//   - contact-create gate fires when contacts_max is reached
//   - cross-tenant isolation: tenant A's usage doesn't bleed into B's
//   - invalidateTenantQuota clears the cache so a plan change takes
//     effect immediately

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { provisionTenant } from "../../src/modules/tenants/tenant-provisioning.service.js";
import {
  assertQuota,
  getCurrentUsage,
  invalidateTenantQuota,
} from "../../src/modules/billing/quota.service.js";
import { seedDefaultPlans } from "../../src/modules/billing/billing.service.js";
import { createContact } from "../../src/modules/contacts/contact.service.js";
import { redis } from "../../src/shared/redis.js";

const p = new PrismaClient();
const fixtureTenantIds = [];

before(async () => {
  await seedDefaultPlans();
});

after(async () => {
  for (const id of fixtureTenantIds) {
    await p.tenant.delete({ where: { id } }).catch(() => {});
  }
  // Drain any quota cache keys from these fixtures so leftover state
  // doesn't bleed into other suites in the same run.
  try {
    const keys = await redis.keys("quota:*");
    if (keys.length) await redis.del(...keys);
  } catch {}
  await p.$disconnect();
  // Redis connection stays open via ioredis — close it so node exits
  // before the 60s test-runner timeout.
  await redis.quit().catch(() => {});
});

beforeEach(async () => {
  // Each test asserts against a fresh cache — otherwise a 60s-TTL hit
  // from an earlier test would mask a real change.
  try {
    const keys = await redis.keys("quota:*");
    if (keys.length) await redis.del(...keys);
  } catch {}
});

async function makeTenantOnPlan(slugPrefix, planSlug = "free") {
  const t = await p.tenant.create({
    data: {
      slug: `${slugPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: slugPrefix,
    },
  });
  await provisionTenant(t.id, {
    includeTestCampaign: false,
    subscriptionSlug: planSlug,
  });
  fixtureTenantIds.push(t.id);
  return t;
}

describe("getCurrentUsage", () => {
  test("returns counts + limits keyed by quota key", async () => {
    const t = await makeTenantOnPlan("c3c-usage", "free");
    const usage = await getCurrentUsage(t.id);
    assert.equal(usage.plan.slug, "free");
    // Free plan has a contacts_max of 50.
    assert.equal(usage.items.contacts_max.limit, 50);
    assert.equal(usage.items.contacts_max.used, 0);
    // messages_per_month is 100 on free.
    assert.equal(usage.items.messages_per_month.limit, 100);
    assert.equal(usage.items.messages_per_month.used, 0);
  });

  test("enterprise plan shows null limits (unlimited)", async () => {
    const t = await makeTenantOnPlan("c3c-ent", "enterprise");
    const usage = await getCurrentUsage(t.id);
    // Enterprise has no quotas configured (limits = {}).
    // getCurrentUsage falls back to the standard key set; each limit
    // will be undefined → returned as null.
    for (const item of Object.values(usage.items)) {
      assert.equal(item.limit, null);
    }
  });
});

describe("assertQuota", () => {
  test("allows when under limit", async () => {
    const t = await makeTenantOnPlan("c3c-allow", "free");
    const r = await assertQuota(t.id, "contacts_max");
    assert.equal(r.allowed, true);
    assert.equal(r.limit, 50);
    assert.equal(r.remaining, 50);
  });

  test("allows when limit is null (unlimited)", async () => {
    const t = await makeTenantOnPlan("c3c-unlimited", "enterprise");
    const r = await assertQuota(t.id, "contacts_max");
    assert.equal(r.allowed, true);
    assert.equal(r.limit, null);
  });

  test("throws QuotaExceeded when over limit", async () => {
    // Make a tenant on a hand-crafted tiny plan so we don't have to
    // create 50 contacts to test the gate.
    const tinyPlan = await p.plan.create({
      data: {
        slug: `c3c-tiny-${Date.now()}`,
        name: "Tiny Test",
        description: "Test-only",
        monthlyPriceCents: 0,
        currency: "USD",
        features: [],
        limits: { contacts_max: 1 },
        displayOrder: 9999,
        isActive: false,
      },
    });
    const t = await makeTenantOnPlan("c3c-over", tinyPlan.slug);
    // First contact lands fine.
    await createContact(t.id, { mobile: "919000000001", firstName: "First" });
    // Second hits the gate (cap is 1, we already have 1).
    let caught;
    try {
      await assertQuota(t.id, "contacts_max");
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "must throw");
    assert.equal(caught.status, 402);
    assert.equal(caught.code, "quota_exceeded");
    assert.equal(caught.details.quota, "contacts_max");
    assert.equal(caught.details.used, 1);
    assert.equal(caught.details.limit, 1);
  });
});

describe("createContact — quota gate wired in service", () => {
  test("blocks the second contact when contacts_max is 1", async () => {
    const tinyPlan = await p.plan.create({
      data: {
        slug: `c3c-cc-tiny-${Date.now()}`,
        name: "Tiny CC",
        monthlyPriceCents: 0,
        currency: "USD",
        features: [],
        limits: { contacts_max: 1 },
        displayOrder: 9999,
        isActive: false,
      },
    });
    const t = await makeTenantOnPlan("c3c-cc", tinyPlan.slug);
    await createContact(t.id, { mobile: "919000000010", firstName: "A" });
    let caught;
    try {
      await createContact(t.id, { mobile: "919000000011", firstName: "B" });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught);
    assert.equal(caught.status, 402);
    assert.equal(caught.code, "quota_exceeded");
    assert.match(caught.message, /Contact quota/);
  });
});

describe("Cross-tenant isolation", () => {
  test("tenant A's contact count doesn't bleed into tenant B's usage", async () => {
    const a = await makeTenantOnPlan("c3c-iso-a", "free");
    const b = await makeTenantOnPlan("c3c-iso-b", "free");
    await createContact(a.id, { mobile: "919111111111", firstName: "A1" });
    await createContact(a.id, { mobile: "919111111112", firstName: "A2" });

    const usageA = await getCurrentUsage(a.id);
    const usageB = await getCurrentUsage(b.id);
    assert.equal(usageA.items.contacts_max.used, 2);
    assert.equal(usageB.items.contacts_max.used, 0);
  });
});

describe("invalidateTenantQuota", () => {
  test("clears cached counters so a plan upgrade takes effect immediately", async () => {
    const t = await makeTenantOnPlan("c3c-inv", "free");
    await createContact(t.id, { mobile: "919222222221", firstName: "X" });
    // Prime the cache.
    const before = await getCurrentUsage(t.id);
    assert.equal(before.items.contacts_max.used, 1);

    // Simulate a plan change. (We don't go through the full webhook
    // here — just bump the subscription's plan + bust the cache.)
    const pro = await p.plan.findUnique({ where: { slug: "pro" } });
    await p.subscription.update({
      where: { tenantId: t.id },
      data: { planId: pro.id },
    });
    await invalidateTenantQuota(t.id);

    const after = await getCurrentUsage(t.id);
    assert.equal(after.plan.slug, "pro");
    // pro has contacts_max=null → unlimited
    assert.equal(after.items.contacts_max.limit, null);
  });
});
