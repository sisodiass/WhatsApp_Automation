// M11.C3a — billing service.
//
// Plan catalog management (seed + list) and per-tenant subscription
// lifecycle helpers. Stripe wiring (Checkout, Portal, webhook) lives
// in C.3b as a separate provider module — this service is the source
// of truth regardless of how the subscription was created.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";

const log = child("billing");

// Default catalog. Operators can edit prices, features, and limits via
// SQL or the admin UI later; this seed only fills missing rows so
// re-running is safe. limits keys are convention only — the
// enforcement layer (C.3c) reads them via well-known names below.
//
// Free plan stays at $0 forever; paid plans get Stripe price IDs in
// C.3b. The Operator plan is hidden from the pricing page (isActive:
// true but tagged in features); operators self-assign it.

export const DEFAULT_PLANS = [
  {
    slug: "free",
    name: "Free",
    description: "Try the platform with a single chat number.",
    monthlyPriceCents: 0,
    currency: "USD",
    displayOrder: 10,
    features: [
      "1 WhatsApp number (shared)",
      "Up to 100 customer messages/month",
      "Up to 50 contacts",
      "Web Chat widget",
      "Community support",
    ],
    limits: {
      messages_per_month: 100,
      contacts_max: 50,
      ai_replies_per_month: 0,
      automations_max: 0,
      channels_max: 1,
      seats_max: 1,
    },
  },
  {
    slug: "starter",
    name: "Starter",
    description: "For solo founders shipping their first AI sales agent.",
    monthlyPriceCents: 1900,
    currency: "USD",
    displayOrder: 20,
    features: [
      "1 WhatsApp number",
      "1,000 customer messages/month",
      "500 contacts",
      "AI replies (OpenAI / Gemini)",
      "Campaigns + drip broadcasts",
      "Email support",
    ],
    limits: {
      messages_per_month: 1000,
      contacts_max: 500,
      ai_replies_per_month: 500,
      automations_max: 5,
      channels_max: 1,
      seats_max: 2,
    },
  },
  {
    slug: "pro",
    name: "Pro",
    description: "For growing teams running multi-channel sales automation.",
    monthlyPriceCents: 4900,
    currency: "USD",
    displayOrder: 30,
    features: [
      "All channels (WhatsApp, IG, FB, Web)",
      "10,000 customer messages/month",
      "Unlimited contacts",
      "Claude / OpenAI / Gemini",
      "Unlimited campaigns + workflows",
      "Quotations + Payment links",
      "Priority email support",
    ],
    limits: {
      messages_per_month: 10000,
      contacts_max: null, // unlimited
      ai_replies_per_month: 5000,
      automations_max: null,
      channels_max: 4,
      seats_max: 10,
    },
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    description: "Custom volumes + SLAs. Talk to us.",
    monthlyPriceCents: 0, // null-priced — contact-us
    currency: "USD",
    displayOrder: 40,
    features: [
      "Custom message volume",
      "Custom AI model + dedicated capacity",
      "Custom integrations",
      "SLA + 24/7 support",
      "SSO + audit log export",
    ],
    limits: {}, // unlimited everywhere
  },
  // Operator plan — NOT shown on the pricing page (isActive=false so it
  // doesn't appear in the public list, but subscriptions can still
  // reference it). Used for the default tenant that runs the deploy.
  {
    slug: "operator",
    name: "Operator (internal)",
    description: "Reserved for the deploy operator. Hidden from pricing.",
    monthlyPriceCents: 0,
    currency: "USD",
    displayOrder: 999,
    isActive: false,
    features: ["Internal — unlimited everything for the deploy operator."],
    limits: {},
  },
];

// Resolve a plan by slug. Throws if it doesn't exist.
export async function getPlanBySlug(slug) {
  const plan = await prisma.plan.findUnique({ where: { slug } });
  if (!plan) throw new Error(`plan "${slug}" not found — seed first`);
  return plan;
}

// Public catalog — anything operators want pricing-page visitors to see.
export async function listActivePlans() {
  return prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
  });
}

// Seed/upsert the catalog. Idempotent — existing rows aren't modified
// (operators can tweak prices/features without losing changes on
// re-seed). New rows from the DEFAULT_PLANS array get created.
export async function seedDefaultPlans() {
  for (const p of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { slug: p.slug },
      update: {}, // don't clobber operator edits
      create: {
        slug: p.slug,
        name: p.name,
        description: p.description,
        monthlyPriceCents: p.monthlyPriceCents,
        currency: p.currency,
        features: p.features,
        limits: p.limits,
        displayOrder: p.displayOrder,
        isActive: p.isActive !== false,
      },
    });
  }
  log.info("default plans seeded", { count: DEFAULT_PLANS.length });
}

// Per-tenant subscription. Auto-creates a Free subscription if the
// tenant has none — keeps the system in a known state for legacy
// tenants created before C.3a landed.
export async function ensureSubscription(tenantId, opts = {}) {
  const existing = await prisma.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
  if (existing) return existing;

  const defaultSlug = opts.defaultPlanSlug || "free";
  const plan = await getPlanBySlug(defaultSlug);
  const sub = await prisma.subscription.create({
    data: {
      tenantId,
      planId: plan.id,
      status: "ACTIVE",
    },
    include: { plan: true },
  });
  log.info("subscription auto-created", {
    tenantId,
    planSlug: plan.slug,
    subscriptionId: sub.id,
  });
  return sub;
}

// Read a tenant's subscription with plan details. Auto-provisions a
// Free subscription if missing (defense for tenants created before
// C.3a, or in case provisionTenant skipped it).
export async function getSubscription(tenantId) {
  let sub = await prisma.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
  if (!sub) {
    sub = await ensureSubscription(tenantId);
  }
  return sub;
}
