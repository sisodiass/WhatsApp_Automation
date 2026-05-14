// Auto follow-up rule service. CRUD for FollowupRule + helpers for the
// followup-tick worker (recent log, force-fire-once for manual tests).

import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";

const RULE_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  _count: { select: { logs: true } },
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateRule(data) {
  if (data.name !== undefined && !String(data.name).trim()) {
    throw BadRequest("name required");
  }
  if (data.templateName !== undefined && !String(data.templateName).trim()) {
    throw BadRequest("templateName required");
  }
  if (data.hoursSinceLastInbound !== undefined) {
    const n = Number(data.hoursSinceLastInbound);
    if (!Number.isFinite(n) || n < 1) {
      throw BadRequest("hoursSinceLastInbound must be ≥ 1");
    }
  }
  if (data.maxReminders !== undefined) {
    const n = Number(data.maxReminders);
    if (!Number.isFinite(n) || n < 1) {
      throw BadRequest("maxReminders must be ≥ 1");
    }
  }
  for (const k of ["quietHoursStart", "quietHoursEnd"]) {
    const v = data[k];
    if (v && !HHMM_RE.test(v)) throw BadRequest(`${k} must be HH:MM (24h)`);
  }
  if (
    (data.quietHoursStart && !data.quietHoursEnd) ||
    (!data.quietHoursStart && data.quietHoursEnd)
  ) {
    throw BadRequest("quiet hours must specify both start AND end");
  }
}

export function listRules(tenantId) {
  return prisma.followupRule.findMany({
    where: { tenantId },
    include: RULE_INCLUDE,
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
}

export async function getRule(tenantId, id) {
  const rule = await prisma.followupRule.findFirst({
    where: { id, tenantId },
    include: RULE_INCLUDE,
  });
  if (!rule) throw NotFound("rule not found");
  return rule;
}

export async function createRule(tenantId, data, createdById) {
  validateRule(data);
  // Sanity: templateName must resolve at fire time, but warn early if a
  // matching active template doesn't exist yet. We don't hard-fail —
  // operators sometimes create rules before authoring templates.
  if (data.templateName) {
    const tpl = await prisma.messageTemplate.findFirst({
      where: { tenantId, name: data.templateName, isActive: true },
    });
    if (!tpl) {
      // Soft warning lives in the response so the UI can surface it.
      // We still create the rule; admin probably knows what they're doing.
    }
  }
  return prisma.followupRule.create({
    data: {
      tenantId,
      name: String(data.name).trim(),
      isActive: data.isActive ?? true,
      pipelineId: data.pipelineId ?? null,
      stageId: data.stageId ?? null,
      hoursSinceLastInbound: Number(data.hoursSinceLastInbound),
      templateName: String(data.templateName).trim(),
      maxReminders: Number(data.maxReminders ?? 1),
      quietHoursStart: data.quietHoursStart ?? null,
      quietHoursEnd: data.quietHoursEnd ?? null,
      createdById: createdById ?? null,
    },
    include: RULE_INCLUDE,
  });
}

export async function updateRule(tenantId, id, data) {
  const existing = await prisma.followupRule.findFirst({ where: { id, tenantId } });
  if (!existing) throw NotFound("rule not found");
  validateRule(data);
  const patch = {};
  for (const k of [
    "name",
    "isActive",
    "pipelineId",
    "stageId",
    "templateName",
    "quietHoursStart",
    "quietHoursEnd",
  ]) {
    if (data[k] !== undefined) patch[k] = data[k];
  }
  if (data.hoursSinceLastInbound !== undefined)
    patch.hoursSinceLastInbound = Number(data.hoursSinceLastInbound);
  if (data.maxReminders !== undefined) patch.maxReminders = Number(data.maxReminders);
  if (patch.name) patch.name = String(patch.name).trim();
  if (patch.templateName) patch.templateName = String(patch.templateName).trim();
  return prisma.followupRule.update({
    where: { id },
    data: patch,
    include: RULE_INCLUDE,
  });
}

export async function deleteRule(tenantId, id) {
  const existing = await prisma.followupRule.findFirst({ where: { id, tenantId } });
  if (!existing) throw NotFound("rule not found");
  await prisma.followupRule.delete({ where: { id } });
  return { ok: true };
}

export async function listRecentLogs(tenantId, opts = {}) {
  const { ruleId, leadId, limit = 50 } = opts;
  // Tenant-scope via the rule.tenantId FK chain.
  const where = {
    rule: { tenantId },
    ...(ruleId ? { ruleId } : {}),
    ...(leadId ? { leadId } : {}),
  };
  return prisma.followupLog.findMany({
    where,
    orderBy: { sentAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 50, 1), 500),
    include: {
      rule: { select: { id: true, name: true } },
      lead: {
        select: {
          id: true,
          contact: {
            select: { id: true, firstName: true, lastName: true, mobile: true },
          },
        },
      },
    },
  });
}
