import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import {
  cancelPaymentLink,
  createPaymentLink,
  getPaymentLink,
  handleWebhookEvent,
  listInvoices,
  listPaymentLinks,
  listTransactions,
  refundPaymentLink,
} from "./payment.service.js";
import {
  getProviderByName,
  getWebhookSecret,
  listPaymentProviders,
} from "./providers/index.js";
import { emitWebhookFailureAlert } from "../../shared/payment-webhook-alerts.js";

const createSchema = z.object({
  amount: z.union([z.number(), z.string()]),
  currency: z.string().length(3).optional(),
  contactId: z.string().optional(),
  leadId: z.string().nullable().optional(),
  quotationId: z.string().nullable().optional(),
  description: z.string().max(500).optional(),
  redirectUrl: z.string().url().optional(),
  metadata: z.record(z.any()).nullable().optional(),
});

export const listLinks = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.json(
    await listPaymentLinks(tenantId, {
      status: req.query.status?.toString(),
      leadId: req.query.leadId?.toString(),
      contactId: req.query.contactId?.toString(),
      page: req.query.page,
      pageSize: req.query.pageSize,
    }),
  );
});

export const getLink = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.json(await getPaymentLink(tenantId, req.params.id));
});

export const createLink = asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  res.status(201).json(await createPaymentLink(tenantId, parsed.data, req.user?.id));
});

export const cancelLink = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.json(await cancelPaymentLink(tenantId, req.params.id));
});

const refundSchema = z.object({
  amount: z.union([z.number(), z.string()]).optional(),
  reason: z.string().max(500).optional(),
});

export const refundLink = asyncHandler(async (req, res) => {
  const parsed = refundSchema.safeParse(req.body || {});
  if (!parsed.success) throw BadRequest("invalid payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  res.json(
    await refundPaymentLink(tenantId, req.params.id, {
      amount: parsed.data.amount,
      reason: parsed.data.reason,
    }),
  );
});

export const listTxns = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.json(
    await listTransactions(tenantId, {
      paymentLinkId: req.query.paymentLinkId?.toString(),
      status: req.query.status?.toString(),
      page: req.query.page,
      pageSize: req.query.pageSize,
    }),
  );
});

export const invoicesList = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.json(
    await listInvoices(tenantId, {
      quotationId: req.query.quotationId?.toString(),
      page: req.query.page,
      pageSize: req.query.pageSize,
    }),
  );
});

export const providersList = asyncHandler(async (_req, res) => {
  res.json({ providers: listPaymentProviders() });
});

// ─── Webhook endpoints ─────────────────────────────────────────────
// These are PUBLIC and verified by HMAC. The raw body capture middleware
// in index.js writes req.rawBody for /api/webhooks/payments/* paths.

function webhookHandler(providerName) {
  return asyncHandler(async (req, res) => {
    const tenantId = await getDefaultTenantId();
    const provider = await getProviderByName(providerName);
    const secret = await getWebhookSecret(providerName.toUpperCase());

    const rawBody = req.rawBody;
    if (!rawBody) {
      return res.status(400).json({ error: { code: "missing_raw_body", message: "raw body required for signature verify" } });
    }

    // STUB never verifies; everything else requires a configured secret.
    const isStub =
      providerName.toUpperCase() === "STUB" ||
      process.env.PAYMENTS_STUB === "true";
    if (!isStub) {
      if (!secret) {
        return res.status(401).json({ error: { code: "no_secret", message: "webhook secret not configured" } });
      }
      const ok = provider.verifyWebhookSignature({
        rawBody,
        headers: req.headers,
        secret,
      });
      if (!ok) {
        return res.status(401).json({ error: { code: "bad_signature", message: "invalid signature" } });
      }
    }

    const event = provider.parseWebhookEvent({ rawBody, headers: req.headers });
    try {
      const result = await handleWebhookEvent(tenantId, providerName.toUpperCase(), event);
      res.json({ ok: true, result });
    } catch (err) {
      // M11.D3: surface webhook-processing failure to operators BEFORE
      // re-throwing. Razorpay and Stripe both retry on 5xx, so the
      // gateway will hit us again — but if our internal processing is
      // persistently broken (e.g. DB down, FK violation from a recent
      // migration), operators need to see it without grep-ing logs.
      //
      // Signature validation already passed at this point. Idempotency
      // on PaymentTransaction (unique on tenant+provider+providerPaymentId)
      // prevents duplicate captures on the gateway's retry.
      await emitWebhookFailureAlert({
        tenantId,
        provider: providerName.toUpperCase(),
        event,
        err,
      });
      throw err;
    }
  });
}

export const razorpayWebhook = webhookHandler("razorpay");
export const stripeWebhook = webhookHandler("stripe");
export const stubWebhook = webhookHandler("stub");

// Dev-only helper: when PAYMENTS_STUB=true, hitting this endpoint emits
// a fully-formed webhook event into the reducer so devs can drive the
// quote → paid flow without touching a real gateway.
export const simulateWebhook = asyncHandler(async (req, res) => {
  if (process.env.PAYMENTS_STUB !== "true") {
    return res.status(404).json({ error: { code: "not_found" } });
  }
  const tenantId = await getDefaultTenantId();
  const provider = await getProviderByName("STUB");
  const event = provider.parseWebhookEvent({
    rawBody: Buffer.from(JSON.stringify(req.body || {}), "utf8"),
    headers: req.headers,
  });
  res.json(await handleWebhookEvent(tenantId, "STUB", event));
});
