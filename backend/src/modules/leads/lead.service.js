import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";
import { emit, Events } from "../../shared/events.js";
import { child } from "../../shared/logger.js";

const log = child("lead");

// All writes that change semantically-meaningful fields ALSO write a
// LeadActivity row. The activity timeline is the audit log + the M3
// timeline UI source. Future M7 automations subscribe to specific kinds
// (STAGE_CHANGE, ASSIGNMENT) via a domain-event emitter that wraps these.

const LEAD_INCLUDE = {
  contact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      mobile: true,
      email: true,
      company: true,
    },
  },
  pipeline: { select: { id: true, name: true } },
  stage: { select: { id: true, name: true, category: true, color: true, order: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  // Inbound campaign (WhatsApp tag-routed). Null for direct + widget leads.
  campaign: { select: { id: true, name: true, tag: true } },
};

async function resolveDefaultPipeline(tenantId, tx = prisma) {
  const p = await tx.pipeline.findFirst({ where: { tenantId, isDefault: true } });
  if (!p) throw BadRequest("no default pipeline — run seed");
  return p;
}

async function resolveFirstStage(pipelineId, tx = prisma) {
  const stage = await tx.stage.findFirst({
    where: { pipelineId },
    orderBy: { order: "asc" },
  });
  if (!stage) throw BadRequest("pipeline has no stages");
  return stage;
}

export async function listLeads(tenantId, opts = {}) {
  const {
    search,
    pipelineId,
    stageId,
    assignedToId,
    score,
    contactId,
    page = 1,
    pageSize = 50,
  } = opts;

  const where = {
    tenantId,
    ...(pipelineId ? { pipelineId } : {}),
    ...(stageId ? { stageId } : {}),
    ...(assignedToId ? { assignedToId } : {}),
    ...(score ? { score } : {}),
    ...(contactId ? { contactId } : {}),
    ...(search
      ? {
          contact: {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { mobile: { contains: search } },
              { email: { contains: search, mode: "insensitive" } },
              { company: { contains: search, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: LEAD_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.lead.count({ where }),
  ]);

  return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
}

export async function getLead(tenantId, id) {
  const l = await prisma.lead.findFirst({
    where: { id, tenantId },
    include: {
      ...LEAD_INCLUDE,
      activities: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          actor: { select: { id: true, name: true } },
          stageFrom: { select: { id: true, name: true } },
          stageTo: { select: { id: true, name: true } },
        },
      },
      tasks: {
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
        include: { assignedTo: { select: { id: true, name: true } } },
      },
      // M7: per-lead AI memory (extracted facts). Single row; null if
      // the lead has never been scored.
      memory: true,
    },
  });
  if (!l) throw NotFound("lead not found");
  return l;
}

export async function createLead(tenantId, data, actorId) {
  if (!data.contactId) throw BadRequest("contactId required");

  return prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findFirst({
      where: { id: data.contactId, tenantId, deletedAt: null },
    });
    if (!contact) throw NotFound("contact not found");

    const pipeline = data.pipelineId
      ? await tx.pipeline.findFirst({ where: { id: data.pipelineId, tenantId } })
      : await resolveDefaultPipeline(tenantId, tx);
    if (!pipeline) throw NotFound("pipeline not found");

    const stage = data.stageId
      ? await tx.stage.findFirst({ where: { id: data.stageId, pipelineId: pipeline.id } })
      : await resolveFirstStage(pipeline.id, tx);
    if (!stage) throw NotFound("stage not found");

    const lead = await tx.lead.create({
      data: {
        tenantId,
        contactId: contact.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        source: data.source ?? null,
        campaignId: data.campaignId ?? null,
        assignedToId: data.assignedToId ?? null,
        expectedValue: data.expectedValue ?? null,
        currency: data.currency ?? null,
      },
      include: LEAD_INCLUDE,
    });

    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        kind: "ASSIGNMENT",
        actorId: actorId ?? null,
        data: {
          event: "lead_created",
          assignedToId: lead.assignedToId,
          stageId: lead.stageId,
        },
      },
    });

    // Domain event — M6 workflow automation will subscribe.
    emit(Events.LEAD_CREATED, {
      leadId: lead.id,
      tenantId,
      contactId: lead.contactId,
      assignedToId: lead.assignedToId,
      actorId: actorId ?? null,
    });

    return lead;
  });
}

export async function updateLead(tenantId, id, data, actorId) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.lead.findFirst({ where: { id, tenantId } });
    if (!existing) throw NotFound("lead not found");

    // Track meaningful transitions to emit activity entries.
    const activities = [];

    if (data.assignedToId !== undefined && data.assignedToId !== existing.assignedToId) {
      activities.push({
        leadId: id,
        kind: "ASSIGNMENT",
        actorId: actorId ?? null,
        data: { from: existing.assignedToId, to: data.assignedToId },
      });
    }

    if (data.stageId !== undefined && data.stageId !== existing.stageId) {
      // Validate stage belongs to lead's pipeline (unless pipeline is also changing).
      const targetPipelineId = data.pipelineId ?? existing.pipelineId;
      const stage = await tx.stage.findFirst({
        where: { id: data.stageId, pipelineId: targetPipelineId },
      });
      if (!stage) throw BadRequest("stage does not belong to the lead's pipeline");
      activities.push({
        leadId: id,
        kind: "STAGE_CHANGE",
        actorId: actorId ?? null,
        stageFromId: existing.stageId,
        stageToId: data.stageId,
      });

      // Won/Lost timestamps — keep alongside stage change so KPIs can
      // filter without joining activities.
      if (stage.category === "WON" && !existing.wonAt) {
        data.wonAt = new Date();
        data.lostAt = null;
        data.lostReason = null;
      } else if (stage.category === "LOST" && !existing.lostAt) {
        data.lostAt = new Date();
        data.wonAt = null;
      } else if (stage.category === "OPEN") {
        data.wonAt = null;
        data.lostAt = null;
      }
    }

    const lead = await tx.lead.update({
      where: { id },
      data,
      include: LEAD_INCLUDE,
    });

    if (activities.length) {
      await tx.leadActivity.createMany({ data: activities });
    }

    // Emit one domain event per kind of meaningful change.
    for (const a of activities) {
      if (a.kind === "STAGE_CHANGE") {
        emit(Events.LEAD_STAGE_CHANGED, {
          leadId: id,
          tenantId,
          fromStageId: a.stageFromId,
          toStageId: a.stageToId,
          actorId: actorId ?? null,
        });
      } else if (a.kind === "ASSIGNMENT") {
        emit(Events.LEAD_ASSIGNED, {
          leadId: id,
          tenantId,
          fromUserId: a.data?.from,
          toUserId: a.data?.to,
          actorId: actorId ?? null,
        });
      }
    }

    return lead;
  });
}

export async function moveLeadStage(tenantId, id, stageId, actorId) {
  return updateLead(tenantId, id, { stageId }, actorId);
}

export async function deleteLead(tenantId, id) {
  const existing = await prisma.lead.findFirst({ where: { id, tenantId } });
  if (!existing) throw NotFound("lead not found");
  await prisma.lead.delete({ where: { id } });
  return { ok: true };
}

// Adds a note tied to the lead's contact (uses the existing notes table —
// notes are per-chat, so we attach them to ANY of the contact's chats; if
// the contact has no chat yet we still need a chat reference, so the note
// goes only on lead-linked chats. For a lead with no chat we emit a NOTE
// activity with the body in the `data` payload instead.
export async function addLeadNote(tenantId, leadId, body, authorId) {
  if (!body?.trim()) throw BadRequest("note body required");
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: { contact: { select: { id: true, chats: { take: 1, select: { id: true } } } } },
  });
  if (!lead) throw NotFound("lead not found");
  const chatId = lead.contact?.chats?.[0]?.id ?? null;

  return prisma.$transaction(async (tx) => {
    let note = null;
    if (chatId) {
      note = await tx.note.create({
        data: { chatId, authorId: authorId ?? null, body: body.trim() },
      });
    }
    await tx.leadActivity.create({
      data: {
        leadId,
        kind: "NOTE",
        noteId: note?.id ?? null,
        actorId: authorId ?? null,
        data: note ? null : { body: body.trim() },
      },
    });
    return note ?? { body: body.trim() };
  });
}

// ─── Central inbound-lead helper ────────────────────────────────────
// Single source of truth for "this contact just touched us on a channel
// — make sure they have a lead". Idempotent: if any lead already exists
// for the contact (open, won, or lost) we return it untouched.
//
// Called from every inbound path:
//   - session.service.upsertChat       (WhatsApp inbound)
//   - meta-webhook.service             (Instagram + FB Messenger)
//   - widget.service.startSession      (Web chat widget)
//   - lead-capture route (later)       (Public API)
//
// Returns the lead row (existing or newly created), or null if the tenant
// has no default pipeline configured (we don't want to fail message
// ingress because of a setup gap — the operator sees a log warning).
//
// metadata accepts the UTM snapshot:
//   { utmSource, utmMedium, utmCampaign, adId, landingPage, referrer }
export async function ensureLeadForContact(tenantId, contactId, source, metadata = {}) {
  if (!tenantId || !contactId) {
    log.warn("ensureLeadForContact missing args", { tenantId, contactId });
    return null;
  }

  // Idempotency: if ANY lead already exists for the contact, skip. We
  // don't filter by open/won/lost — once a lead exists, a re-touch on
  // the same contact is "they're back", not "fresh lead".
  const existing = await prisma.lead.findFirst({
    where: { tenantId, contactId },
    include: LEAD_INCLUDE,
  });
  if (existing) return existing;

  const pipeline = await prisma.pipeline.findFirst({
    where: { tenantId, isDefault: true },
    include: { stages: { orderBy: { order: "asc" }, take: 1 } },
  });
  if (!pipeline?.stages?.[0]) {
    log.warn("no default pipeline / first stage — cannot auto-create lead", {
      tenantId, contactId, source,
    });
    return null;
  }

  const lead = await prisma.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        tenantId,
        contactId,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[0].id,
        source: source ?? null,
        utmSource: metadata.utmSource ?? null,
        utmMedium: metadata.utmMedium ?? null,
        utmCampaign: metadata.utmCampaign ?? null,
        adId: metadata.adId ?? null,
        landingPage: metadata.landingPage ?? null,
        referrer: metadata.referrer ?? null,
      },
      include: LEAD_INCLUDE,
    });
    await tx.leadActivity.create({
      data: {
        leadId: created.id,
        kind: "ASSIGNMENT",
        data: {
          event: "lead_auto_created",
          source: source ?? null,
          channel: source ?? null,
        },
      },
    });
    return created;
  });

  // Fire LEAD_CREATED so automations + notifications run consistently
  // with the manual /api/leads path.
  emit(Events.LEAD_CREATED, {
    leadId: lead.id,
    tenantId,
    contactId,
    assignedToId: null,
    actorId: null,
    autoCreated: true,
    source: source ?? null,
  });

  log.info("auto-created lead", {
    tenantId, contactId, source, leadId: lead.id,
  });
  return lead;
}

// Kanban board: leads grouped by stage for a pipeline.
export async function getBoard(tenantId, pipelineId, opts = {}) {
  const { assignedToId, score } = opts;
  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, tenantId },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  if (!pipeline) throw NotFound("pipeline not found");

  const where = {
    tenantId,
    pipelineId,
    ...(assignedToId ? { assignedToId } : {}),
    ...(score ? { score } : {}),
  };
  const leads = await prisma.lead.findMany({
    where,
    include: LEAD_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  const byStage = new Map(pipeline.stages.map((s) => [s.id, []]));
  for (const lead of leads) {
    const bucket = byStage.get(lead.stageId);
    if (bucket) bucket.push(lead);
  }
  return {
    pipeline: { id: pipeline.id, name: pipeline.name },
    stages: pipeline.stages.map((s) => ({
      ...s,
      leads: byStage.get(s.id) ?? [],
    })),
  };
}
