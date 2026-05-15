import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });
dotenv.config(); // also try backend/.env

const prisma = new PrismaClient();

const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || "default";
const TENANT_NAME = process.env.DEFAULT_TENANT_NAME || "Default Tenant";
// NOTE: must be a valid RFC-style email (the auth controller's Zod validator
// rejects bare "admin@local" — the TLD is required).
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@local.test";

function generatePassword() {
  // 16 bytes -> ~22 url-safe chars
  return crypto.randomBytes(16).toString("base64url");
}

async function main() {
  // 1. Tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: {},
    create: { slug: TENANT_SLUG, name: TENANT_NAME },
  });

  // 2. Super admin
  const existingAdmin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existingAdmin) {
    console.log(`✓ Super admin already exists: ${existingAdmin.email}`);
  } else {
    const plainPassword = process.env.SEED_ADMIN_PASSWORD || generatePassword();
    const passwordHash = await bcrypt.hash(plainPassword, 12);
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: ADMIN_EMAIL,
        passwordHash,
        name: "Super Admin",
        role: "SUPER_ADMIN",
      },
    });
    console.log("");
    console.log("══════════════════════════════════════════════");
    console.log(" Super admin created (save this password!)");
    console.log("══════════════════════════════════════════════");
    console.log(`  Email:    ${user.email}`);
    console.log(`  Password: ${plainPassword}`);
    console.log("══════════════════════════════════════════════");
    console.log("");
  }

  // 3. Default settings (reply strings live in message_templates, not here).
  const defaultSettings = [
    // Active provider + per-provider model selections. Switch from the
    // Settings panel; each provider's API key still comes from .env.
    { key: "ai.provider", value: "openai" },
    { key: "ai.openai.chat_model", value: "gpt-4o-mini" },
    { key: "ai.openai.embedding_model", value: "text-embedding-3-small" },
    { key: "ai.gemini.chat_model", value: "gemini-2.0-flash" },
    { key: "ai.gemini.embedding_model", value: "gemini-embedding-001" },
    // M11.B: Anthropic Claude as a chat-only provider. Embeddings fall
    // back to ai.embedding_provider (default openai) since Claude has no
    // first-party embedding API.
    { key: "ai.claude.api_key", value: "", encrypted: true },
    { key: "ai.claude.chat_model", value: "claude-3-5-sonnet-latest" },
    // Which provider supplies embeddings. Only used when ai.provider is
    // "claude". Must be openai or gemini.
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
    // Warmup mode: when true, outgoing-messages worker uses a slower rate
    // and slightly larger delays. For new numbers / restored sessions.
    { key: "wa.warmup_mode", value: false },
    { key: "wa.warmup_outbound_per_minute_max", value: 10 },
    { key: "wa.warmup_delay_min_seconds", value: 15 },
    { key: "wa.warmup_delay_max_seconds", value: 40 },
    // Manual queue SLA: items older than this are flagged in the UI.
    { key: "manual_queue.sla_minutes", value: 10 },
    // Microsoft Graph (Teams demo booking — Phase 9). Seeded as empty
    // placeholders so the "Microsoft Teams" section renders in Settings UI
    // even before the operator fills them. Until all four are set, demo
    // booking falls back to stub mode (records the booking, sends
    // placeholder URL). client_secret is upgraded to encrypted on first
    // real write — see settings.service.setSetting.
    { key: "microsoft.tenant_id", value: "" },
    { key: "microsoft.client_id", value: "" },
    { key: "microsoft.client_secret", value: "", encrypted: true },
    { key: "microsoft.organizer_user_id", value: "" },

    // M11 — Quotations + Payments. The default provider is STUB so dev
    // environments don't need a Razorpay/Stripe account to exercise the
    // flow. Switch via Settings UI once credentials are in place.
    { key: "payments.default_provider", value: "STUB" },
    { key: "payments.currency_default", value: "INR" },
    { key: "payments.razorpay.key_id", value: "", encrypted: true },
    { key: "payments.razorpay.key_secret", value: "", encrypted: true },
    { key: "payments.razorpay.webhook_secret", value: "", encrypted: true },
    { key: "payments.stripe.publishable_key", value: "", encrypted: true },
    { key: "payments.stripe.secret_key", value: "", encrypted: true },
    { key: "payments.stripe.webhook_secret", value: "", encrypted: true },
    // PaymentLink default lifetime (hours from creation). 0 = no expiry.
    { key: "payments.link_expiry_hours", value: 72 },

    // Quotation numbering + defaults. number_format placeholders:
    //   {prefix}   from quotations.number_prefix
    //   {yyyy}     4-digit current year
    //   {seq:NNNN} zero-padded counter, scoped per (tenant, year)
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
  ];

  for (const s of defaultSettings) {
    await prisma.setting.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: s.key } },
      update: {},
      create: {
        tenantId: tenant.id,
        key: s.key,
        value: s.value,
        encrypted: s.encrypted ?? false,
      },
    });
  }
  console.log(`✓ Tenant "${tenant.slug}" + ${defaultSettings.length} default settings ready`);

  // 4. Default message templates (the bot's reply text). Edit them via the
  //    admin UI later; do not bake reply strings into code.
  const templates = [
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
      content:
        "Your demo is booked for {{scheduled_at}}. Join here: {{join_url}}",
      variables: ["scheduled_at", "join_url"],
    },
    // M11 revenue templates. Reusing FALLBACK as the `type` because the
    // TemplateType enum doesn't carry per-template-purpose values — the
    // `name` is the actual lookup key. (Adding new enum values to keep
    // analytics clean is fine for a future migration; the engine treats
    // FALLBACK as "non-special".)
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

  for (const t of templates) {
    await prisma.messageTemplate.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: t.name } },
      update: {},
      create: {
        tenantId: tenant.id,
        name: t.name,
        type: t.type,
        content: t.content,
        variables: t.variables,
        isActive: true,
      },
    });
  }
  console.log(`✓ ${templates.length} message templates ready`);

  // 5. Default sales pipeline + 7 stages (CRM). System pipeline — cannot
  //    be deleted; default flag is enforced via partial unique index
  //    applied in db-init.js (one default per tenant).
  const DEFAULT_STAGES = [
    { name: "New",             order: 10, category: "OPEN", color: "#94a3b8" },
    { name: "Contacted",       order: 20, category: "OPEN", color: "#60a5fa" },
    { name: "Qualified",       order: 30, category: "OPEN", color: "#22d3ee" },
    { name: "Demo Scheduled",  order: 40, category: "OPEN", color: "#a78bfa" },
    // M11: stage that quotation.service moves a lead into on send().
    // If renamed/removed by operators the auto-move silently no-ops —
    // intentional so custom pipelines aren't forced to keep this name.
    { name: "Quotation Sent",  order: 45, category: "OPEN", color: "#f472b6" },
    { name: "Negotiation",     order: 50, category: "OPEN", color: "#fb923c" },
    { name: "Won",             order: 60, category: "WON",  color: "#22c55e" },
    { name: "Lost",            order: 70, category: "LOST", color: "#ef4444" },
  ];

  const existingDefault = await prisma.pipeline.findFirst({
    where: { tenantId: tenant.id, isDefault: true },
  });
  let defaultPipeline = existingDefault;
  if (!defaultPipeline) {
    defaultPipeline = await prisma.pipeline.create({
      data: {
        tenantId: tenant.id,
        name: "Sales",
        isDefault: true,
        isSystem: true,
      },
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
  console.log(`✓ default pipeline "${defaultPipeline.name}" with ${DEFAULT_STAGES.length} stages ready`);

  // 6. Default channels (M9). Idempotent on (tenantId, type).
  //    Backfills chats.channel_id for any existing rows missing it.
  const CHANNELS = [
    { type: "WHATSAPP", name: "WhatsApp" },
    { type: "WEB_CHAT", name: "Web Chat" },
  ];
  const channelsByType = {};
  for (const c of CHANNELS) {
    const channel = await prisma.channel.upsert({
      where: { tenantId_type: { tenantId: tenant.id, type: c.type } },
      update: {},
      create: { tenantId: tenant.id, type: c.type, name: c.name },
    });
    channelsByType[c.type] = channel;
  }
  // Backfill — existing chats predate channels; assume WhatsApp.
  const wa = channelsByType.WHATSAPP;
  if (wa) {
    const linked = await prisma.chat.updateMany({
      where: { tenantId: tenant.id, channelId: null },
      data: { channelId: wa.id },
    });
    if (linked.count > 0) {
      console.log(`✓ backfilled ${linked.count} chats to WhatsApp channel`);
    }
  }
  console.log(`✓ ${CHANNELS.length} default channels ready`);

  // 7. Internal test campaign. Operator-only — never deleted, tag/name
  //    locked. Use it to verify QR reconnect, provider switches, and
  //    end-to-end flow without touching live campaigns.
  const TEST_TAG = "CAMPAIGN_TEST_INTERNAL";
  await prisma.campaign.upsert({
    where: { tag: TEST_TAG },
    // Only update mutable fields if the operator hasn't customized them.
    // We keep the upsert idempotent on re-seed by using update:{} — the
    // operator can still edit onboardingMessage / kbGroups / isActive
    // through the UI; we just never overwrite their changes.
    update: { isSystem: true },
    create: {
      tenantId: tenant.id,
      tag: TEST_TAG,
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
  console.log(`✓ system test campaign "${TEST_TAG}" ready`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
