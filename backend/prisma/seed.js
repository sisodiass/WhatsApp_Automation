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

  // 5. Internal test campaign. Operator-only — never deleted, tag/name
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
