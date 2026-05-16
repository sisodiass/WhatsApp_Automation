// Per-tenant scaffolding shared by:
//   - prisma/seed.js          — first-time setup of the default tenant.
//   - auth signup endpoint    — every new SaaS sign-up.
//
// What this provisions (idempotent — safe to re-run):
//   1. Default settings (AI providers, session, WhatsApp, manual-queue,
//      handover, email, Microsoft Graph, payments, quotations, invoices).
//   2. Default message templates (the bot's reply copy).
//   3. Default sales pipeline + standard stages (CRM).
//   4. Default channels (WhatsApp, Web Chat).
//   5. Internal test campaign (operator smoke-test entry point).
//
// Idempotency: every write uses an upsert keyed on (tenantId, natural-key)
// or findFirst-then-create. Re-running on an existing tenant is a no-op
// for already-present rows; new defaults added later are filled in.
//
// Each tenant is fully self-contained — no cross-tenant fan-out — so
// running this on tenant A never touches tenant B's data.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";

const log = child("provisioning");

const DEFAULT_SETTINGS = [
  { key: "ai.provider", value: "openai" },
  { key: "ai.openai.chat_model", value: "gpt-4o-mini" },
  { key: "ai.openai.embedding_model", value: "text-embedding-3-small" },
  { key: "ai.gemini.chat_model", value: "gemini-2.0-flash" },
  { key: "ai.gemini.embedding_model", value: "gemini-embedding-001" },
  { key: "ai.claude.api_key", value: "", encrypted: true },
  { key: "ai.claude.chat_model", value: "claude-3-5-sonnet-latest" },
  { key: "ai.embedding_provider", value: "openai" },
  { key: "ai.global_enabled", value: true },
  { key: "ai.max_replies_per_session", value: 10 },
  { key: "ai.confidence_threshold", value: 0.82 },
  { key: "ai.concurrent_retrieval_limit", value: 3 },
  { key: "ai.generation_timeout_seconds", value: 15 },
  { key: "session.inactivity_reset_days", value: 7 },
  { key: "session.resume_after_hours", value: 24 },
  { key: "wa.delay_min_seconds", value: 8 },
  { key: "wa.delay_max_seconds", value: 25 },
  { key: "wa.outbound_per_minute_max", value: 30 },
  { key: "wa.warmup_mode", value: false },
  { key: "wa.warmup_outbound_per_minute_max", value: 10 },
  { key: "wa.warmup_delay_min_seconds", value: 15 },
  { key: "wa.warmup_delay_max_seconds", value: 40 },
  { key: "manual_queue.sla_minutes", value: 10 },
  { key: "handover.human_request_enabled", value: true },
  {
    key: "handover.human_request_keywords",
    value:
      "human,real person,real human,agent,speak to someone,talk to a person,talk to someone,representative,customer service,customer support,live person,support team,actual person",
  },
  { key: "handover.negative_sentiment_enabled", value: false },
  {
    key: "handover.negative_sentiment_keywords",
    value:
      "frustrated,angry,furious,terrible,awful,unacceptable,refund,cancel my,disappointed,unhappy,worst,useless,scam,fraud,complaint,lawsuit",
  },
  { key: "email.enabled", value: true },
  { key: "email.provider", value: "stub" },
  { key: "email.from_address", value: "noreply@local.test" },
  { key: "email.from_name", value: "SalesAutomation" },
  {
    key: "email.notify_kinds",
    value: "JOB_FAILED,WEBHOOK_FAILED,AI_QUOTATION_REVIEW",
  },
  { key: "email.resend.api_key", value: "", encrypted: true },
  { key: "email.postmark.server_token", value: "", encrypted: true },
  { key: "microsoft.tenant_id", value: "" },
  { key: "microsoft.client_id", value: "" },
  { key: "microsoft.client_secret", value: "", encrypted: true },
  { key: "microsoft.organizer_user_id", value: "" },
  { key: "payments.default_provider", value: "STUB" },
  { key: "payments.currency_default", value: "INR" },
  { key: "payments.razorpay.key_id", value: "", encrypted: true },
  { key: "payments.razorpay.key_secret", value: "", encrypted: true },
  { key: "payments.razorpay.webhook_secret", value: "", encrypted: true },
  { key: "payments.stripe.publishable_key", value: "", encrypted: true },
  { key: "payments.stripe.secret_key", value: "", encrypted: true },
  { key: "payments.stripe.webhook_secret", value: "", encrypted: true },
  { key: "payments.link_expiry_hours", value: 72 },
  { key: "quotations.number_prefix", value: "QTN" },
  { key: "quotations.number_format", value: "{prefix}-{yyyy}-{seq:06}" },
  { key: "quotations.default_validity_days", value: 14 },
  { key: "quotations.tax_rate_default", value: 18 },
  { key: "quotations.approval_threshold_amount", value: 100000 },
  {
    key: "quotations.terms_default",
    value:
      "1. Prices are valid for the validity period stated above.\n" +
      "2. Taxes are included where applicable.\n" +
      "3. Advance payment may be required to confirm the order.",
  },
  { key: "invoices.number_prefix", value: "INV" },
  { key: "invoices.number_format", value: "{prefix}-{yyyy}-{seq:06}" },
  // M11.C2: SaaS signup gate. Default false — existing single-tenant
  // deploys stay safe. Operators flip it ON via Settings when they
  // want to open public signups (or set it tenant-by-tenant via DB).
  { key: "tenant.signup_enabled", value: false },
];

const DEFAULT_TEMPLATES = [
  {
    name: "onboarding_default",
    type: "ONBOARDING_DEFAULT",
    content: "Hi {{customer_name}}, welcome! How can I help you today?",
    variables: ["customer_name"],
  },
  {
    name: "manual_handoff",
    type: "MANUAL_HANDOFF",
    content: "Our team member will continue assisting you shortly.",
    variables: [],
  },
  {
    name: "fallback",
    type: "FALLBACK",
    content: "I can currently assist only with topics available in our knowledge base.",
    variables: [],
  },
  {
    name: "session_resume",
    type: "SESSION_RESUME",
    content: "Welcome back. Continuing your previous assistance session.",
    variables: [],
  },
  {
    name: "demo_confirmation",
    type: "DEMO_CONFIRMATION",
    content: "Your demo is booked for {{scheduled_at}}. Join here: {{join_url}}",
    variables: ["scheduled_at", "join_url"],
  },
  {
    name: "quote_sent",
    type: "FALLBACK",
    content:
      "Hi {{customer_name}}, here's your quotation {{quote_number}} for {{currency}} {{grand_total}}, valid until {{valid_until}}. {{pdf_url}}",
    variables: [
      "customer_name",
      "quote_number",
      "currency",
      "grand_total",
      "valid_until",
      "pdf_url",
    ],
  },
  {
    name: "payment_link",
    type: "FALLBACK",
    content:
      "Hi {{customer_name}}, please use this secure link to pay {{currency}} {{amount}}: {{payment_url}}",
    variables: ["customer_name", "currency", "amount", "payment_url"],
  },
  {
    name: "payment_confirmed",
    type: "FALLBACK",
    content:
      "Thank you {{customer_name}}! Your payment of {{currency}} {{amount}} has been received. Reference: {{txn_id}}.",
    variables: ["customer_name", "currency", "amount", "txn_id"],
  },
  {
    name: "payment_failed",
    type: "FALLBACK",
    content:
      "Hi {{customer_name}}, we couldn't confirm your payment of {{currency}} {{amount}}. Please try again or reach out to us.",
    variables: ["customer_name", "currency", "amount"],
  },
  {
    name: "quote_expired",
    type: "FALLBACK",
    content:
      "Hi {{customer_name}}, your quotation {{quote_number}} expired on {{valid_until}}. Reply if you'd like a fresh quote.",
    variables: ["customer_name", "quote_number", "valid_until"],
  },
];

const DEFAULT_STAGES = [
  { name: "New", order: 10, category: "OPEN", color: "#94a3b8" },
  { name: "Contacted", order: 20, category: "OPEN", color: "#60a5fa" },
  { name: "Qualified", order: 30, category: "OPEN", color: "#22d3ee" },
  { name: "Demo Scheduled", order: 40, category: "OPEN", color: "#a78bfa" },
  { name: "Quotation Sent", order: 45, category: "OPEN", color: "#f472b6" },
  { name: "Negotiation", order: 50, category: "OPEN", color: "#fb923c" },
  { name: "Won", order: 60, category: "WON", color: "#22c55e" },
  { name: "Lost", order: 70, category: "LOST", color: "#ef4444" },
];

const DEFAULT_CHANNELS = [
  { type: "WHATSAPP", name: "WhatsApp" },
  { type: "WEB_CHAT", name: "Web Chat" },
];

/**
 * Provision per-tenant scaffolding. Idempotent — re-running is safe.
 *
 * @param {string} tenantId — must already exist in `tenants`.
 * @param {object} [opts]
 * @param {boolean} [opts.includeTestCampaign=false] — when true, also
 *        seeds the operator-only CAMPAIGN_TEST_INTERNAL row. Default
 *        false so SaaS sign-ups don't ship with a stray test entry;
 *        the default-tenant seed passes true.
 * @param {string}  [opts.testCampaignTag] — override the tag (mostly
 *        for tests). Defaults to "CAMPAIGN_TEST_INTERNAL".
 * @returns {Promise<{ settings:number, templates:number, stages:number,
 *                     channels:number, pipelineId:string|null }>}
 */
export async function provisionTenant(tenantId, opts = {}) {
  if (!tenantId) throw new Error("provisionTenant: tenantId required");

  // 1. Default settings.
  for (const s of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: s.key } },
      update: {},
      create: {
        tenantId,
        key: s.key,
        value: s.value,
        encrypted: s.encrypted ?? false,
      },
    });
  }

  // 2. Default message templates.
  for (const t of DEFAULT_TEMPLATES) {
    await prisma.messageTemplate.upsert({
      where: { tenantId_name: { tenantId, name: t.name } },
      update: {},
      create: {
        tenantId,
        name: t.name,
        type: t.type,
        content: t.content,
        variables: t.variables,
        isActive: true,
      },
    });
  }

  // 3. Default sales pipeline + stages.
  let defaultPipeline = await prisma.pipeline.findFirst({
    where: { tenantId, isDefault: true },
  });
  if (!defaultPipeline) {
    defaultPipeline = await prisma.pipeline.create({
      data: { tenantId, name: "Sales", isDefault: true, isSystem: true },
    });
  }
  for (const s of DEFAULT_STAGES) {
    const existing = await prisma.stage.findFirst({
      where: { pipelineId: defaultPipeline.id, name: s.name },
    });
    if (!existing) {
      await prisma.stage.create({
        data: { pipelineId: defaultPipeline.id, ...s },
      });
    }
  }

  // 4. Default channels.
  const channelsByType = {};
  for (const c of DEFAULT_CHANNELS) {
    const channel = await prisma.channel.upsert({
      where: { tenantId_type: { tenantId, type: c.type } },
      update: {},
      create: { tenantId, type: c.type, name: c.name },
    });
    channelsByType[c.type] = channel;
  }
  // Backfill chats missing channelId (only relevant for the default
  // tenant which predates the Channel model).
  const wa = channelsByType.WHATSAPP;
  if (wa) {
    await prisma.chat
      .updateMany({
        where: { tenantId, channelId: null },
        data: { channelId: wa.id },
      })
      .catch(() => {}); // soft — not worth failing the whole provisioning
  }

  // 5. Internal test campaign (operator-only, opt-in via flag).
  if (opts.includeTestCampaign) {
    const tag = opts.testCampaignTag || "CAMPAIGN_TEST_INTERNAL";
    await prisma.campaign.upsert({
      where: { tag },
      update: { isSystem: true },
      create: {
        tenantId,
        tag,
        name: "Test (internal)",
        isActive: true,
        isSystem: true,
        onboardingMessage:
          "Internal test campaign. This message confirms WhatsApp connectivity " +
          "and onboarding delivery. Send any question after this — if you've " +
          "attached KB groups in the campaign editor, the AI pipeline will " +
          "answer; otherwise the conversation will route to MANUAL.",
        businessType: null,
      },
    });
  }

  log.info("tenant provisioned", {
    tenantId,
    includeTestCampaign: opts.includeTestCampaign === true,
  });
  return {
    settings: DEFAULT_SETTINGS.length,
    templates: DEFAULT_TEMPLATES.length,
    stages: DEFAULT_STAGES.length,
    channels: DEFAULT_CHANNELS.length,
    pipelineId: defaultPipeline?.id || null,
  };
}
