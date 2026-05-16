// M11.C3a — billing service.
//
// Plan catalog management (seed + list) and per-tenant subscription
// lifecycle helpers. Stripe wiring (Checkout, Portal, webhook) lives
// in C.3b as a separate provider module — this service is the source
// of truth regardless of how the subscription was created.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { config } from "../../config/index.js";
import { BadRequest, Conflict, NotFound } from "../../shared/errors.js";
import { getBillingProvider } from "./providers/index.js";

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

// ─── M11.C3b: Stripe Checkout + Portal + webhook ──────────────────

function buildReturnUrl(path) {
  const base = (config.frontendUrl || "").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * Start a Stripe Checkout session for a plan upgrade.
 *
 *   - Looks up the target plan by slug.
 *   - Requires the plan to have a stripePriceId (paid plans only).
 *     Free plan upgrades go through changePlan() instead.
 *   - Reuses the tenant's existing stripeCustomerId when present so
 *     saved payment methods carry over.
 *   - Returns the Stripe Checkout URL — frontend redirects to it.
 *
 * On success: Stripe fires `checkout.session.completed` →
 *   handleStripeWebhook updates the local Subscription via metadata.
 */
export async function createCheckoutSession({ tenantId, planSlug, userEmail }) {
  if (!tenantId || !planSlug) throw BadRequest("tenantId + planSlug required");
  const plan = await prisma.plan.findUnique({ where: { slug: planSlug } });
  if (!plan || !plan.isActive) throw NotFound(`plan "${planSlug}" not found`);
  if (!plan.stripePriceId) {
    throw BadRequest(
      `plan "${planSlug}" has no Stripe price configured — operator must paste a price_id`,
    );
  }

  const sub = await getSubscription(tenantId);
  if (sub.plan.slug === planSlug && sub.status === "ACTIVE") {
    throw Conflict("already subscribed to this plan");
  }

  const { provider } = await getBillingProvider();
  const successUrl = buildReturnUrl("/billing?status=success");
  const cancelUrl = buildReturnUrl("/billing?status=cancelled");

  const result = await provider.createCheckoutSession({
    tenantId,
    planSlug,
    priceId: plan.stripePriceId,
    customerId: sub.stripeCustomerId || null,
    customerEmail: userEmail || null,
    successUrl,
    cancelUrl,
  });
  log.info("checkout session created", {
    tenantId,
    planSlug,
    sessionId: result.sessionId,
  });
  return result;
}

/**
 * Stripe Customer Portal — the operator-hosted page where customers
 * update payment methods, view invoices, cancel, etc. Requires the
 * tenant to have a `stripeCustomerId` (set on first successful
 * checkout). Free-plan tenants don't have one yet → 400.
 */
export async function createPortalSession({ tenantId }) {
  const sub = await getSubscription(tenantId);
  if (!sub.stripeCustomerId) {
    throw BadRequest(
      "no Stripe customer on file — complete a checkout first to access the portal",
    );
  }
  const { provider } = await getBillingProvider();
  const result = await provider.createPortalSession({
    customerId: sub.stripeCustomerId,
    returnUrl: buildReturnUrl("/billing"),
  });
  log.info("portal session created", { tenantId });
  return result;
}

// ─── Webhook handler ──────────────────────────────────────────────
//
// Stripe events we care about (mapped → side effects):
//
//   checkout.session.completed
//     A new checkout flow finished. Pull tenantId + planSlug from
//     metadata, look up the planId, then transition the local
//     Subscription. Sets stripeCustomerId + stripeSubscriptionId.
//
//   customer.subscription.updated
//     Plan change OR cancel-at-period-end toggle. Updates planId,
//     status, period dates, cancelAtPeriodEnd.
//
//   customer.subscription.deleted
//     Final cancellation (after current period or immediate). Mark
//     status=CANCELLED; downgrade plan to free when the period ends.
//     For v1 we transition to free immediately; C.3c can add the
//     grace-period gate.
//
//   invoice.payment_succeeded
//     Renewal succeeded — refresh period dates + status=ACTIVE.
//
//   invoice.payment_failed
//     Payment failed → status=PAST_DUE so the UI can show a banner.
//
// All other event types are recorded for dedup but otherwise ignored.

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

export async function handleStripeWebhook(event) {
  // Dedup: insert the event row; unique constraint short-circuits
  // retries. Returns `null` on duplicate so the route handler can
  // 200 immediately.
  const tenantId = event.data?.object?.metadata?.tenantId || null;
  try {
    await prisma.billingWebhookEvent.create({
      data: {
        providerEventId: event.id,
        provider: "STRIPE",
        type: event.type,
        tenantId,
        rawPayload: event.raw || {},
      },
    });
  } catch (err) {
    // Unique violation → already processed.
    if (err.code === "P2002") {
      log.info("duplicate webhook event ignored", { eventId: event.id, type: event.type });
      return { duplicate: true };
    }
    throw err;
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    log.debug("webhook event recorded (no handler)", { type: event.type });
    return { recorded: true };
  }

  const obj = event.data?.object || {};

  if (event.type === "checkout.session.completed") {
    const tid = obj.metadata?.tenantId;
    const planSlug = obj.metadata?.planSlug;
    if (!tid || !planSlug) {
      log.warn("checkout.session.completed missing metadata", { eventId: event.id });
      return { skipped: "missing_metadata" };
    }
    await applyPlanChange(tid, planSlug, {
      stripeCustomerId: obj.customer || null,
      stripeSubscriptionId: obj.subscription || null,
      status: "ACTIVE",
    });
    log.info("subscription activated from checkout", { tid, planSlug });
    return { applied: "checkout" };
  }

  if (event.type === "customer.subscription.updated") {
    const subscriptionId = obj.id;
    const status = mapStripeSubscriptionStatus(obj.status);
    const planSlug = obj.metadata?.planSlug;
    const tid = obj.metadata?.tenantId || (await findTenantByStripeSubscription(subscriptionId));
    if (!tid) {
      log.warn("subscription.updated without resolvable tenant", { subscriptionId });
      return { skipped: "no_tenant" };
    }
    const patch = {
      status,
      cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
      currentPeriodStart: obj.current_period_start
        ? new Date(obj.current_period_start * 1000)
        : null,
      currentPeriodEnd: obj.current_period_end
        ? new Date(obj.current_period_end * 1000)
        : null,
    };
    // Plan change.
    if (planSlug) {
      const plan = await prisma.plan.findUnique({ where: { slug: planSlug } });
      if (plan) patch.planId = plan.id;
    }
    await prisma.subscription.update({
      where: { tenantId: tid },
      data: patch,
    });
    log.info("subscription updated", { tid, status, planSlug });
    return { applied: "updated" };
  }

  if (event.type === "customer.subscription.deleted") {
    const subscriptionId = obj.id;
    const tid = obj.metadata?.tenantId || (await findTenantByStripeSubscription(subscriptionId));
    if (!tid) return { skipped: "no_tenant" };
    // Move back to free for now. C.3c can add grace-period logic.
    await applyPlanChange(tid, "free", {
      status: "CANCELLED",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      stripeSubscriptionId: null,
    });
    log.info("subscription cancelled → reverted to free", { tid });
    return { applied: "cancelled" };
  }

  if (event.type === "invoice.payment_succeeded") {
    const subscriptionId = obj.subscription;
    const tid = obj.metadata?.tenantId || (await findTenantByStripeSubscription(subscriptionId));
    if (!tid) return { skipped: "no_tenant" };
    await prisma.subscription.update({
      where: { tenantId: tid },
      data: {
        status: "ACTIVE",
        currentPeriodStart: obj.period_start ? new Date(obj.period_start * 1000) : undefined,
        currentPeriodEnd: obj.period_end ? new Date(obj.period_end * 1000) : undefined,
      },
    });
    return { applied: "renewed" };
  }

  if (event.type === "invoice.payment_failed") {
    const subscriptionId = obj.subscription;
    const tid = obj.metadata?.tenantId || (await findTenantByStripeSubscription(subscriptionId));
    if (!tid) return { skipped: "no_tenant" };
    await prisma.subscription.update({
      where: { tenantId: tid },
      data: { status: "PAST_DUE" },
    });
    log.warn("subscription payment failed", { tid });
    return { applied: "past_due" };
  }

  return { ok: true };
}

// Look up a Subscription by its stripeSubscriptionId. Used when an
// event doesn't carry tenantId in metadata (older events, Portal-
// triggered changes, etc.).
async function findTenantByStripeSubscription(stripeSubscriptionId) {
  if (!stripeSubscriptionId) return null;
  const row = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId },
    select: { tenantId: true },
  });
  return row?.tenantId || null;
}

// Apply a plan change to a tenant's subscription. Looks up the plan
// by slug, updates planId + any passed-through fields (status, Stripe
// IDs, period dates).
async function applyPlanChange(tenantId, planSlug, extras = {}) {
  const plan = await prisma.plan.findUnique({ where: { slug: planSlug } });
  if (!plan) throw new Error(`plan "${planSlug}" not found`);
  return prisma.subscription.update({
    where: { tenantId },
    data: { planId: plan.id, ...extras },
  });
}

// Stripe subscription.status → our SubscriptionStatus enum.
function mapStripeSubscriptionStatus(stripeStatus) {
  switch (stripeStatus) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
      return "CANCELLED";
    case "incomplete":
    case "incomplete_expired":
      return "EXPIRED";
    default:
      return "ACTIVE";
  }
}

// Admin: set the Stripe Price ID on a plan (operator copies this from
// their Stripe dashboard after creating Products + Prices).
export async function setPlanStripePriceId(slug, stripePriceId) {
  if (!slug) throw BadRequest("slug required");
  const plan = await prisma.plan.findUnique({ where: { slug } });
  if (!plan) throw NotFound(`plan "${slug}" not found`);
  return prisma.plan.update({
    where: { id: plan.id },
    data: { stripePriceId: stripePriceId || null },
  });
}
