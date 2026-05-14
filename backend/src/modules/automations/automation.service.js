import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";
import { spawnRun } from "./automation.engine.js";

const RULE_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  _count: { select: { runs: true } },
};

const TRIGGERS = ["NEW_LEAD", "STAGE_CHANGED", "LEAD_ASSIGNED", "NO_REPLY", "TAG_ADDED", "CAMPAIGN_REPLIED", "INBOUND_KEYWORD"];
const STEP_TYPES = ["WAIT", "SEND_MESSAGE", "ASSIGN", "ADD_TAG", "MOVE_STAGE", "CREATE_TASK", "IF"];

function validateDefinition(definition) {
  if (!definition || typeof definition !== "object") {
    throw BadRequest("definition must be an object");
  }
  const steps = definition.steps;
  if (!Array.isArray(steps)) throw BadRequest("definition.steps must be an array");
  if (steps.length === 0) throw BadRequest("definition.steps cannot be empty");
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s || typeof s !== "object" || !s.type) {
      throw BadRequest(`step ${i}: missing 'type'`);
    }
    if (!STEP_TYPES.includes(s.type)) {
      throw BadRequest(`step ${i}: unknown type "${s.type}"`);
    }
    if (s.type === "WAIT" && (typeof s.minutes !== "number" || s.minutes < 0)) {
      throw BadRequest(`step ${i} (WAIT): 'minutes' must be a non-negative number`);
    }
    if (s.type === "SEND_MESSAGE" && !s.templateName) {
      throw BadRequest(`step ${i} (SEND_MESSAGE): 'templateName' required`);
    }
    if (s.type === "ASSIGN" && !s.userId) {
      throw BadRequest(`step ${i} (ASSIGN): 'userId' required`);
    }
    if (s.type === "ADD_TAG" && !s.tagId) {
      throw BadRequest(`step ${i} (ADD_TAG): 'tagId' required`);
    }
    if (s.type === "MOVE_STAGE" && !s.stageId) {
      throw BadRequest(`step ${i} (MOVE_STAGE): 'stageId' required`);
    }
    if (s.type === "CREATE_TASK" && (!s.title || !s.title.trim())) {
      throw BadRequest(`step ${i} (CREATE_TASK): 'title' required`);
    }
    if (s.type === "IF" && !s.condition) {
      throw BadRequest(`step ${i} (IF): 'condition' required`);
    }
  }
}

export function listAutomations(tenantId) {
  return prisma.automation.findMany({
    where: { tenantId },
    include: RULE_INCLUDE,
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
}

export async function getAutomation(tenantId, id) {
  const a = await prisma.automation.findFirst({
    where: { id, tenantId },
    include: RULE_INCLUDE,
  });
  if (!a) throw NotFound("automation not found");
  return a;
}

export async function createAutomation(tenantId, data, createdById) {
  if (!data.name?.trim()) throw BadRequest("name required");
  if (!TRIGGERS.includes(data.trigger)) throw BadRequest("invalid trigger");
  validateDefinition(data.definition);
  return prisma.automation.create({
    data: {
      tenantId,
      name: data.name.trim(),
      isActive: data.isActive ?? true,
      trigger: data.trigger,
      triggerConfig: data.triggerConfig ?? null,
      definition: data.definition,
      createdById: createdById ?? null,
    },
    include: RULE_INCLUDE,
  });
}

export async function updateAutomation(tenantId, id, data) {
  const existing = await prisma.automation.findFirst({ where: { id, tenantId } });
  if (!existing) throw NotFound("automation not found");
  if (data.trigger && !TRIGGERS.includes(data.trigger)) throw BadRequest("invalid trigger");
  if (data.definition !== undefined) validateDefinition(data.definition);
  const patch = {};
  for (const k of ["name", "isActive", "trigger", "triggerConfig", "definition"]) {
    if (data[k] !== undefined) patch[k] = data[k];
  }
  if (patch.name) patch.name = String(patch.name).trim();
  return prisma.automation.update({
    where: { id },
    data: patch,
    include: RULE_INCLUDE,
  });
}

export async function deleteAutomation(tenantId, id) {
  const existing = await prisma.automation.findFirst({ where: { id, tenantId } });
  if (!existing) throw NotFound("automation not found");
  await prisma.automation.delete({ where: { id } });
  return { ok: true };
}

export async function listRecentRuns(tenantId, opts = {}) {
  const { automationId, leadId, status, limit = 50 } = opts;
  const where = {
    automation: { tenantId },
    ...(automationId ? { automationId } : {}),
    ...(leadId ? { leadId } : {}),
    ...(status ? { status } : {}),
  };
  return prisma.automationRun.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 50, 1), 500),
    include: {
      automation: { select: { id: true, name: true, trigger: true } },
      lead: {
        select: {
          id: true,
          contact: { select: { id: true, firstName: true, lastName: true, mobile: true } },
        },
      },
    },
  });
}

// Manual fire — useful for testing. Forces a run for the given lead
// regardless of trigger filters.
export async function fireForLead(tenantId, automationId, leadId) {
  const automation = await prisma.automation.findFirst({
    where: { id: automationId, tenantId },
  });
  if (!automation) throw NotFound("automation not found");
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
  if (!lead) throw NotFound("lead not found");
  const payload = {
    leadId: lead.id,
    tenantId,
    contactId: lead.contactId,
    manual: true,
  };
  return spawnRun(automation, payload);
}
