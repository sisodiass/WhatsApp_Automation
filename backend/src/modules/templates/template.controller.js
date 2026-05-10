import { z } from "zod";
import { asyncHandler, BadRequest, NotFound } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { getDefaultTenantId } from "../../shared/tenant.js";

const TYPES = ["ONBOARDING_DEFAULT", "MANUAL_HANDOFF", "FALLBACK", "SESSION_RESUME", "DEMO_CONFIRMATION"];

const templateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_]+$/, "name must be lowercase letters, digits, or underscores"),
  type: z.enum(TYPES),
  content: z.string().min(1).max(2000),
  variables: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

export const list = asyncHandler(async (_req, res) => {
  const tenantId = await getDefaultTenantId();
  const items = await prisma.messageTemplate.findMany({
    where: { tenantId },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  res.json({ items });
});

export const create = asyncHandler(async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid template payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const t = await prisma.messageTemplate
    .create({ data: { tenantId, ...parsed.data } })
    .catch((err) => {
      if (err.code === "P2002") throw BadRequest("template with this name already exists");
      throw err;
    });
  res.status(201).json(t);
});

export const patch = asyncHandler(async (req, res) => {
  const parsed = templateSchema.partial().safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid template payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const existing = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.tenantId !== tenantId) throw NotFound("template not found");
  const t = await prisma.messageTemplate.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json(t);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const existing = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.tenantId !== tenantId) throw NotFound("template not found");
  await prisma.messageTemplate.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
