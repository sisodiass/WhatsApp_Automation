import { Router } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import {
  cancelLink,
  createLink,
  getLink,
  invoicesList,
  listLinks,
  listTxns,
  providersList,
  razorpayWebhook,
  refundLink,
  simulateWebhook,
  stripeWebhook,
  stubWebhook,
} from "./payment.controller.js";

const WRITE = ["SUPER_ADMIN", "ADMIN", "AGENT"];
const ADMIN = ["SUPER_ADMIN", "ADMIN"];

// Authenticated CRUD + listings.
export const paymentRouter = Router();
paymentRouter.use(requireAuth);

paymentRouter.get("/providers", providersList);
paymentRouter.get("/links", listLinks);
paymentRouter.get("/links/:id", getLink);
paymentRouter.post("/links", requireRole(...WRITE), createLink);
paymentRouter.post("/links/:id/cancel", requireRole(...WRITE), cancelLink);
paymentRouter.post("/links/:id/refund", requireRole(...ADMIN), refundLink);

paymentRouter.get("/transactions", listTxns);

// Invoices live alongside payments since they're produced by the same flow.
export const invoiceRouter = Router();
invoiceRouter.use(requireAuth);
invoiceRouter.get("/", invoicesList);

// Public webhook endpoints — no JWT, signature-verified.
// Mounted under /api/webhooks/payments/* so the raw-body middleware in
// index.js captures req.rawBody.
export const paymentWebhookRouter = Router();
paymentWebhookRouter.post("/razorpay", razorpayWebhook);
paymentWebhookRouter.post("/stripe", stripeWebhook);
paymentWebhookRouter.post("/stub", stubWebhook);
paymentWebhookRouter.post("/simulate", simulateWebhook);
