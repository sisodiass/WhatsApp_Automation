// Billing endpoints.
//
// Public (no auth):
//   GET  /api/billing/plans          — pricing page + signup
//
// Authenticated (req.auth.tenantId):
//   GET  /api/billing/subscription   — current plan + status
//   POST /api/billing/checkout       — start Stripe Checkout
//   POST /api/billing/portal         — Stripe Customer Portal session
//
// Public (signature-verified, mounted SEPARATELY in index.js so the
// raw-body middleware fires):
//   POST /api/webhooks/billing/stripe — Stripe subscription lifecycle
//
// SUPER_ADMIN only (operator-facing):
//   PATCH /api/billing/plans/:slug   — set Stripe price ID on a plan

import { Router } from "express";
import { z } from "zod";
import { asyncHandler, BadRequest, Unauthorized } from "../../shared/errors.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  createCheckoutSession,
  createPortalSession,
  getSubscription,
  handleStripeWebhook,
  listActivePlans,
  setPlanStripePriceId,
} from "./billing.service.js";
import { getBillingProvider } from "./providers/index.js";

export const billingPublicRouter = Router();
export const billingRouter = Router();
export const billingWebhookRouter = Router();

billingRouter.use(requireAuth);

// Public — used by /signup and the pricing page.
billingPublicRouter.get(
  "/plans",
  asyncHandler(async (_req, res) => {
    const plans = await listActivePlans();
    res.json({
      items: plans.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        monthlyPriceCents: p.monthlyPriceCents,
        currency: p.currency,
        features: p.features,
        limits: p.limits,
        displayOrder: p.displayOrder,
        // Frontend uses this to enable the "Choose" button only when
        // the operator has pasted a Stripe price id for the plan.
        hasStripePrice: Boolean(p.stripePriceId),
      })),
    });
  }),
);

// Authenticated — current tenant's subscription + plan details.
billingRouter.get(
  "/subscription",
  asyncHandler(async (req, res) => {
    const sub = await getSubscription(req.auth.tenantId);
    res.json({
      id: sub.id,
      status: sub.status,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      hasStripeCustomer: Boolean(sub.stripeCustomerId),
      plan: {
        id: sub.plan.id,
        slug: sub.plan.slug,
        name: sub.plan.name,
        description: sub.plan.description,
        monthlyPriceCents: sub.plan.monthlyPriceCents,
        currency: sub.plan.currency,
        features: sub.plan.features,
        limits: sub.plan.limits,
      },
    });
  }),
);

const checkoutSchema = z.object({
  planSlug: z.string().min(1),
});

// Start a Stripe Checkout session. Returns the redirect URL — the
// frontend does `window.location.href = url`.
billingRouter.post(
  "/checkout",
  asyncHandler(async (req, res) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) throw BadRequest("invalid checkout payload");
    // Pull the user's email so Stripe pre-fills it on first checkout.
    // (Prisma Setting is per-tenant; user email lives on the User row.)
    const user = await import("../users/user.service.js").then((m) =>
      m.findUserById(req.auth.userId),
    );
    const result = await createCheckoutSession({
      tenantId: req.auth.tenantId,
      planSlug: parsed.data.planSlug,
      userEmail: user?.email || null,
    });
    res.json(result);
  }),
);

// Stripe Customer Portal session — for managing payment methods,
// downloading invoices, cancelling, etc. Requires the tenant to have
// completed at least one Checkout (stripeCustomerId must be set).
billingRouter.post(
  "/portal",
  asyncHandler(async (req, res) => {
    const result = await createPortalSession({ tenantId: req.auth.tenantId });
    res.json(result);
  }),
);

// Operator-only plan admin. Body: { stripePriceId } — null/empty
// clears the wiring. Used to paste price_xxx values from Stripe.
const stripePriceSchema = z.object({
  stripePriceId: z.string().nullable().optional(),
});

billingRouter.patch(
  "/plans/:slug",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const parsed = stripePriceSchema.safeParse(req.body);
    if (!parsed.success) throw BadRequest("invalid payload");
    const plan = await setPlanStripePriceId(req.params.slug, parsed.data.stripePriceId);
    res.json({ slug: plan.slug, stripePriceId: plan.stripePriceId });
  }),
);

// ─── Webhook (separate router so the raw-body middleware fires) ───

billingWebhookRouter.post(
  "/stripe",
  asyncHandler(async (req, res) => {
    const { provider, secrets } = await getBillingProvider();
    const rawBody = req.rawBody;
    if (!rawBody) return res.status(400).json({ error: { code: "missing_raw_body" } });

    // STUB doesn't verify; real Stripe requires the webhook secret.
    const isStub = provider.name === "stub";
    if (!isStub) {
      if (!secrets.webhookSecret) {
        return res
          .status(401)
          .json({ error: { code: "no_webhook_secret", message: "billing.stripe.webhook_secret not configured" } });
      }
      const ok = provider.verifyWebhookSignature({
        rawBody,
        headers: req.headers,
        secret: secrets.webhookSecret,
      });
      if (!ok) {
        return res.status(401).json({ error: { code: "bad_signature" } });
      }
    }

    const event = provider.parseWebhookEvent({ rawBody, headers: req.headers });
    const result = await handleStripeWebhook(event);
    res.json({ ok: true, ...result });
  }),
);
