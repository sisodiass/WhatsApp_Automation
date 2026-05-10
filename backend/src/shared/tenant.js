// Single-tenant per deploy in v1. We resolve the default tenant once at
// boot and cache the id; all services read from this cache.

import { prisma } from "./prisma.js";
import { config } from "../config/index.js";

let cachedId = null;

export async function getDefaultTenantId() {
  if (cachedId) return cachedId;
  const t = await prisma.tenant.findUnique({ where: { slug: config.tenant.defaultSlug } });
  if (!t) throw new Error(`tenant '${config.tenant.defaultSlug}' not found — did you run npm run seed?`);
  cachedId = t.id;
  return cachedId;
}
