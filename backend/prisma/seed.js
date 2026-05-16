// First-time setup of the DEFAULT tenant. Per-tenant scaffolding lives
// in src/modules/tenants/tenant-provisioning.service.js so that the
// signup endpoint reuses identical defaults — this script is now just
// (a) create the Tenant, (b) create the super-admin user, (c) call the
// provisioning service.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { provisionTenant } from "../src/modules/tenants/tenant-provisioning.service.js";

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

  // 3-7. Settings, templates, pipeline + stages, channels, test campaign.
  //      The provisioning service is idempotent; rerunning the seed is safe.
  const result = await provisionTenant(tenant.id, {
    includeTestCampaign: true,
  });
  console.log(`✓ Tenant "${tenant.slug}" + ${result.settings} default settings ready`);
  console.log(`✓ ${result.templates} message templates ready`);
  console.log(`✓ default pipeline with ${result.stages} stages ready`);
  console.log(`✓ ${result.channels} default channels ready`);
  console.log(`✓ system test campaign "CAMPAIGN_TEST_INTERNAL" ready`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
