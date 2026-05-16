import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import {
  createPricingRule,
  createProduct,
  deletePricingRule,
  getProduct,
  listPricingRules,
  listProducts,
  softDeleteProduct,
  updatePricingRule,
  updateProduct,
} from "./product.service.js";

const productSchema = z.object({
  sku: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  basePrice: z.union([z.number(), z.string()]),
  currency: z.string().length(3),
  taxRatePct: z.union([z.number(), z.string()]).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  metadata: z.record(z.any()).nullable().optional(),
});

export const list = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const result = await listProducts(tenantId, {
    search: req.query.search?.toString(),
    status: req.query.status?.toString(),
    includeDeleted: req.query.includeDeleted === "true",
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json(result);
});

export const getOne = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.json(await getProduct(tenantId, req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid product payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  res.status(201).json(await createProduct(tenantId, parsed.data));
});

export const patch = asyncHandler(async (req, res) => {
  const parsed = productSchema.partial().safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid product payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  res.json(await updateProduct(tenantId, req.params.id, parsed.data));
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  await softDeleteProduct(tenantId, req.params.id);
  res.status(204).end();
});

const pricingRuleSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["VOLUME_TIER", "SEGMENT", "TIME_BOUND"]),
  productId: z.string().nullable().optional(),
  config: z.record(z.any()),
  priority: z.number().int().optional(),
  active: z.boolean().optional(),
});

export const listRules = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  res.json({ items: await listPricingRules(tenantId) });
});

export const createRule = asyncHandler(async (req, res) => {
  const parsed = pricingRuleSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid rule payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  res.status(201).json(await createPricingRule(tenantId, parsed.data));
});

export const patchRule = asyncHandler(async (req, res) => {
  const parsed = pricingRuleSchema.partial().safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid rule payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  res.json(await updatePricingRule(tenantId, req.params.id, parsed.data));
});

export const removeRule = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  await deletePricingRule(tenantId, req.params.id);
  res.status(204).end();
});
