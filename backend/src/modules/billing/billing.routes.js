// Billing endpoints. GET /plans is public (pricing page) — everything
// else is authenticated, tenant-scoped via req.auth.tenantId.

import { Router } from "express";
import { asyncHandler } from "../../shared/errors.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { getSubscription, listActivePlans } from "./billing.service.js";

export const billingPublicRouter = Router();
export const billingRouter = Router();

billingRouter.use(requireAuth);

// Public — used by /signup and the marketing pricing page.
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
