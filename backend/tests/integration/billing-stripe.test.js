// M11.C3b — Stripe Billing integration tests via BILLING_STUB=true.
//
// The stub provider mirrors the Stripe contract (createCheckoutSession,
// createPortalSession, verifyWebhookSignature, parseWebhookEvent) but
// records every call in an inspectable in-memory log. Lets us drive
// the full happy path + webhook idempotency + lifecycle transitions
// without a Stripe account or network access.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();
process.env.BILLING_STUB = "true";

import { PrismaClient } from "@prisma/client";
import { provisionTenant } from "../../src/modules/tenants/tenant-provisioning.service.js";
import {
  createCheckoutSession,
  createPortalSession,
  handleStripeWebhook,
  seedDefaultPlans,
  setPlanStripePriceId,
} from "../../src/modules/billing/billing.service.js";
import {
  clearStubBillingLog,
  getStubBillingLog,
} from "../../src/modules/billing/providers/index.js";

const p = new PrismaClient();
const fixtureTenantIds = [];

before(async () => {
  await seedDefaultPlans();
  // Wire fake Stripe price IDs for paid plans so checkout doesn't bail.
  await setPlanStripePriceId("starter", "price_test_starter");
  await setPlanStripePriceId("pro", "price_test_pro");
});

after(async () => {
  for (const id of fixtureTenantIds) {
    await p.tenant.delete({ where: { id } }).catch(() => {});
  }
  // Clean up the fake price IDs so they don't leak into other suites.
  await setPlanStripePriceId("starter", null);
  await setPlanStripePriceId("pro", null);
  await p.$disconnect();
});

beforeEach(() => {
  clearStubBillingLog();
});

async function makeTenant(slugPrefix) {
  const t = await p.tenant.create({
    data: {
      slug: `${slugPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: slugPrefix,
    },
  });
  await provisionTenant(t.id, { includeTestCampaign: false });
  fixtureTenantIds.push(t.id);
  return t;
}

describe("createCheckoutSession", () => {
  test("returns a URL for an active paid plan with a stripePriceId", async () => {
    const t = await makeTenant("c3b-co-1");
    const res = await createCheckoutSession({
      tenantId: t.id,
      planSlug: "pro",
      userEmail: "test@local.test",
    });
    assert.ok(res.url, "checkout url returned");
    assert.ok(res.sessionId.startsWith("cs_stub_"));
    // Stub log captures the call with tenantId metadata
    const log = getStubBillingLog();
    assert.equal(log.length, 1);
    assert.equal(log[0].input.tenantId, t.id);
    assert.equal(log[0].input.planSlug, "pro");
    assert.equal(log[0].input.priceId, "price_test_pro");
  });

  test("rejects when plan has no stripePriceId", async () => {
    const t = await makeTenant("c3b-co-2");
    await assert.rejects(
      () =>
        createCheckoutSession({
          tenantId: t.id,
          planSlug: "enterprise", // no stripePriceId by design
        }),
      /Stripe price/i,
    );
  });

  test("rejects when already on the target plan", async () => {
    const t = await makeTenant("c3b-co-3");
    // Move tenant to pro first via a synthetic webhook
    await handleStripeWebhook({
      id: `evt_pre_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: t.id, planSlug: "pro" },
          customer: "cus_test_x",
          subscription: "sub_test_x",
        },
      },
      raw: {},
    });
    await assert.rejects(
      () => createCheckoutSession({ tenantId: t.id, planSlug: "pro" }),
      /already subscribed/i,
    );
  });
});

describe("createPortalSession", () => {
  test("rejects when tenant has no Stripe customer yet", async () => {
    const t = await makeTenant("c3b-portal-1");
    await assert.rejects(
      () => createPortalSession({ tenantId: t.id }),
      /complete a checkout/i,
    );
  });

  test("returns a portal URL after a successful checkout", async () => {
    const t = await makeTenant("c3b-portal-2");
    // Simulate the customer.session.completed event so stripeCustomerId
    // gets populated.
    await handleStripeWebhook({
      id: `evt_co_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: t.id, planSlug: "starter" },
          customer: "cus_test_portal",
          subscription: "sub_test_portal",
        },
      },
      raw: {},
    });
    const res = await createPortalSession({ tenantId: t.id });
    assert.ok(res.url.includes("stub_portal"));
  });
});

describe("handleStripeWebhook — lifecycle", () => {
  test("checkout.session.completed activates subscription + records Stripe IDs", async () => {
    const t = await makeTenant("c3b-life-1");
    await handleStripeWebhook({
      id: `evt_life1_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: t.id, planSlug: "pro" },
          customer: "cus_x",
          subscription: "sub_x",
        },
      },
      raw: {},
    });
    const sub = await p.subscription.findUnique({
      where: { tenantId: t.id },
      include: { plan: true },
    });
    assert.equal(sub.plan.slug, "pro");
    assert.equal(sub.status, "ACTIVE");
    assert.equal(sub.stripeCustomerId, "cus_x");
    assert.equal(sub.stripeSubscriptionId, "sub_x");
  });

  test("customer.subscription.updated reflects status + plan changes", async () => {
    const t = await makeTenant("c3b-life-2");
    // Start on pro.
    await handleStripeWebhook({
      id: `evt_setup_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: t.id, planSlug: "pro" },
          customer: "cus_y",
          subscription: "sub_y",
        },
      },
      raw: {},
    });
    // Downgrade to starter.
    await handleStripeWebhook({
      id: `evt_upd_${Date.now()}`,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_y",
          status: "active",
          cancel_at_period_end: false,
          current_period_start: 1715000000,
          current_period_end: 1717678400,
          metadata: { tenantId: t.id, planSlug: "starter" },
        },
      },
      raw: {},
    });
    const sub = await p.subscription.findUnique({
      where: { tenantId: t.id },
      include: { plan: true },
    });
    assert.equal(sub.plan.slug, "starter");
    assert.equal(sub.status, "ACTIVE");
    assert.ok(sub.currentPeriodStart);
    assert.ok(sub.currentPeriodEnd);
  });

  test("customer.subscription.deleted reverts to free + status CANCELLED", async () => {
    const t = await makeTenant("c3b-life-3");
    await handleStripeWebhook({
      id: `evt_setup_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: t.id, planSlug: "pro" },
          customer: "cus_d",
          subscription: "sub_d",
        },
      },
      raw: {},
    });
    await handleStripeWebhook({
      id: `evt_del_${Date.now()}`,
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_d",
          metadata: { tenantId: t.id },
        },
      },
      raw: {},
    });
    const sub = await p.subscription.findUnique({
      where: { tenantId: t.id },
      include: { plan: true },
    });
    assert.equal(sub.plan.slug, "free");
    assert.equal(sub.status, "CANCELLED");
    assert.equal(sub.stripeSubscriptionId, null);
  });

  test("invoice.payment_failed → PAST_DUE", async () => {
    const t = await makeTenant("c3b-life-4");
    await handleStripeWebhook({
      id: `evt_setup_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: t.id, planSlug: "pro" },
          customer: "cus_f",
          subscription: "sub_f",
        },
      },
      raw: {},
    });
    await handleStripeWebhook({
      id: `evt_fail_${Date.now()}`,
      type: "invoice.payment_failed",
      data: {
        object: {
          subscription: "sub_f",
          metadata: { tenantId: t.id },
        },
      },
      raw: {},
    });
    const sub = await p.subscription.findUnique({ where: { tenantId: t.id } });
    assert.equal(sub.status, "PAST_DUE");
  });
});

describe("handleStripeWebhook — idempotency", () => {
  test("replaying the same event is a no-op", async () => {
    const t = await makeTenant("c3b-idem");
    const eventId = `evt_idem_${Date.now()}`;
    const event = {
      id: eventId,
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: t.id, planSlug: "starter" },
          customer: "cus_idem",
          subscription: "sub_idem",
        },
      },
      raw: {},
    };
    const r1 = await handleStripeWebhook(event);
    const r2 = await handleStripeWebhook(event);
    assert.equal(r1.applied, "checkout");
    assert.equal(r2.duplicate, true);
    // Only one row in billingWebhookEvent for this id
    const count = await p.billingWebhookEvent.count({
      where: { providerEventId: eventId },
    });
    assert.equal(count, 1);
  });
});

describe("setPlanStripePriceId", () => {
  test("updates the price id and clears on null", async () => {
    await setPlanStripePriceId("pro", "price_admin_x");
    let plan = await p.plan.findUnique({ where: { slug: "pro" } });
    assert.equal(plan.stripePriceId, "price_admin_x");
    await setPlanStripePriceId("pro", null);
    plan = await p.plan.findUnique({ where: { slug: "pro" } });
    assert.equal(plan.stripePriceId, null);
    // restore for other tests in this file's run
    await setPlanStripePriceId("pro", "price_test_pro");
  });

  test("rejects unknown slug", async () => {
    await assert.rejects(() => setPlanStripePriceId("nonexistent", "x"), /not found/);
  });
});
