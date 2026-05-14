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

// Returns the Prisma `where`-clause fragment that scopes lead queries to
// what the requesting user is allowed to see. SUPER_ADMIN/ADMIN see every
// lead in the tenant; AGENT sees only leads assigned to them; VIEWER
// reads the whole tenant but cannot write (RBAC at the route layer).
//
// Use by spreading into a where:  prisma.lead.findMany({ where: { ...whereLeadsForUser(user) } })
export function whereLeadsForUser(user) {
  if (!user) return { id: "__no_user__" };
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN" || user.role === "VIEWER") {
    return { tenantId: user.tenantId };
  }
  // AGENT — assigned leads only.
  return { tenantId: user.tenantId, assignedToId: user.id };
}
