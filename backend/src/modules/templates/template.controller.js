import { z } from "zod";
import { asyncHandler, BadRequest, NotFound } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { interpolate } from "./template.service.js";
import {
  buildSampleVars,
  buildVarsForContact,
  buildVarsForLead,
  listVariables,
} from "./variables.js";

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

export const list = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const items = await prisma.messageTemplate.findMany({
    where: { tenantId },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  res.json({ items });
});

export const create = asyncHandler(async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid template payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
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
  const tenantId = req.auth.tenantId;
  const existing = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.tenantId !== tenantId) throw NotFound("template not found");
  const t = await prisma.messageTemplate.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json(t);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const existing = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.tenantId !== tenantId) throw NotFound("template not found");
  await prisma.messageTemplate.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// ─── Variables registry (autocomplete UI) ───────────────────────────

export const variables = asyncHandler(async (req, res) => {
  res.json(listVariables());
});

// ─── Live preview ───────────────────────────────────────────────────
// POST /api/templates/preview { content, leadId?, contactId? }
// Renders `content` against the requested lead/contact context (or sample
// values if neither is provided). Operators see exactly what their
// customers will see, missing-key gaps included.

const previewSchema = z.object({
  content: z.string().min(1).max(5000),
  leadId: z.string().optional(),
  contactId: z.string().optional(),
  extras: z.record(z.any()).optional(),
});

export const preview = asyncHandler(async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid preview payload", parsed.error.flatten());
  const tenantId = req.auth.tenantId;
  const { content, leadId, contactId, extras } = parsed.data;

  let vars;
  if (leadId) vars = await buildVarsForLead(leadId, tenantId, extras || {});
  else if (contactId) vars = await buildVarsForContact(contactId, tenantId, extras || {});
  else vars = { ...buildSampleVars(), ...(extras || {}) };

  const rendered = interpolate(content, vars);
  res.json({ rendered });
});
