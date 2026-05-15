// Catalog (Product) + PricingRule services.
// All queries scope on tenantId; soft-delete via deletedAt.

import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";

const ACTIVE_WHERE = (tenantId) => ({ tenantId, deletedAt: null });

export async function listProducts(tenantId, opts = {}) {
  const {
    search,
    status,
    includeDeleted = false,
    page = 1,
    pageSize = 50,
  } = opts;
  const where = {
    tenantId,
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip,
      take,
    }),
    prisma.product.count({ where }),
  ]);
  return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
}

export async function getProduct(tenantId, id) {
  const p = await prisma.product.findFirst({
    where: { id, ...ACTIVE_WHERE(tenantId) },
  });
  if (!p) throw NotFound("product not found");
  return p;
}

export async function createProduct(tenantId, data) {
  if (!data.sku?.trim()) throw BadRequest("sku required");
  if (!data.name?.trim()) throw BadRequest("name required");
  if (data.basePrice == null) throw BadRequest("basePrice required");
  if (!data.currency?.trim()) throw BadRequest("currency required");
  try {
    return await prisma.product.create({
      data: {
        tenantId,
        sku: String(data.sku).trim(),
        name: String(data.name).trim(),
        description: data.description ?? null,
        basePrice: new Prisma.Decimal(data.basePrice),
        currency: String(data.currency).toUpperCase().slice(0, 3),
        taxRatePct: new Prisma.Decimal(data.taxRatePct ?? 0),
        status: data.status ?? "ACTIVE",
        metadata: data.metadata ?? null,
      },
    });
  } catch (err) {
    if (err.code === "P2002") throw BadRequest("a product with this SKU already exists");
    throw err;
  }
}

export async function updateProduct(tenantId, id, data) {
  const existing = await prisma.product.findFirst({
    where: { id, ...ACTIVE_WHERE(tenantId) },
  });
  if (!existing) throw NotFound("product not found");
  const next = {};
  if (data.sku !== undefined) next.sku = String(data.sku).trim();
  if (data.name !== undefined) next.name = String(data.name).trim();
  if (data.description !== undefined) next.description = data.description;
  if (data.basePrice !== undefined) next.basePrice = new Prisma.Decimal(data.basePrice);
  if (data.currency !== undefined) next.currency = String(data.currency).toUpperCase().slice(0, 3);
  if (data.taxRatePct !== undefined) next.taxRatePct = new Prisma.Decimal(data.taxRatePct);
  if (data.status !== undefined) next.status = data.status;
  if (data.metadata !== undefined) next.metadata = data.metadata;
  try {
    return await prisma.product.update({ where: { id }, data: next });
  } catch (err) {
    if (err.code === "P2002") throw BadRequest("a product with this SKU already exists");
    throw err;
  }
}

export async function softDeleteProduct(tenantId, id) {
  const existing = await prisma.product.findFirst({
    where: { id, ...ACTIVE_WHERE(tenantId) },
  });
  if (!existing) throw NotFound("product not found");
  await prisma.product.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  return { ok: true };
}

// ─── Pricing rules ──────────────────────────────────────────────────

export async function listPricingRules(tenantId) {
  return prisma.pricingRule.findMany({
    where: { tenantId },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });
}

export async function createPricingRule(tenantId, data) {
  if (!data.name?.trim()) throw BadRequest("name required");
  if (!data.kind) throw BadRequest("kind required");
  if (!data.config || typeof data.config !== "object") {
    throw BadRequest("config required");
  }
  return prisma.pricingRule.create({
    data: {
      tenantId,
      name: String(data.name).trim(),
      kind: data.kind,
      productId: data.productId ?? null,
      config: data.config,
      priority: Number(data.priority ?? 100),
      active: data.active !== false,
    },
  });
}

export async function updatePricingRule(tenantId, id, data) {
  const existing = await prisma.pricingRule.findFirst({
    where: { id, tenantId },
  });
  if (!existing) throw NotFound("pricing rule not found");
  return prisma.pricingRule.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.kind !== undefined ? { kind: data.kind } : {}),
      ...(data.productId !== undefined ? { productId: data.productId } : {}),
      ...(data.config !== undefined ? { config: data.config } : {}),
      ...(data.priority !== undefined ? { priority: Number(data.priority) } : {}),
      ...(data.active !== undefined ? { active: !!data.active } : {}),
    },
  });
}

export async function deletePricingRule(tenantId, id) {
  const existing = await prisma.pricingRule.findFirst({
    where: { id, tenantId },
  });
  if (!existing) throw NotFound("pricing rule not found");
  await prisma.pricingRule.delete({ where: { id } });
  return { ok: true };
}
