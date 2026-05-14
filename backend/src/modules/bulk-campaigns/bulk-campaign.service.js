// Bulk-campaign service. State machine:
//
//   DRAFT ─── submit ──▶ PENDING_APPROVAL ─── approve ──▶ SCHEDULED
//   DRAFT ────────────── approve (skip review) ─────────▶ SCHEDULED
//   SCHEDULED ─── drip-tick (when scheduledAt ≤ now) ──▶ RUNNING
//   RUNNING ─── all recipients resolved ────────────────▶ COMPLETED
//   RUNNING / SCHEDULED ─── pause ──────────────────────▶ PAUSED
//   PAUSED ─── resume ──────────────────────────────────▶ SCHEDULED
//   ANY (non-terminal) ─── cancel ──────────────────────▶ CANCELLED
//
// Recipients are materialized at audience-add time so a snapshot of the
// audience is preserved even if the underlying segment changes later.

import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";
import { getSettings } from "../settings/settings.service.js";

// ─── CRUD ───────────────────────────────────────────────────────────

const LIST_INCLUDE = {
  createdBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true } },
  _count: { select: { recipients: true } },
};

export async function listBulkCampaigns(tenantId, opts = {}) {
  const { status, page = 1, pageSize = 25 } = opts;
  const where = { tenantId, ...(status ? { status } : {}) };
  const take = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const [items, total] = await Promise.all([
    prisma.bulkCampaign.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.bulkCampaign.count({ where }),
  ]);
  return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
}

export async function getBulkCampaign(tenantId, id) {
  const c = await prisma.bulkCampaign.findFirst({
    where: { id, tenantId },
    include: {
      ...LIST_INCLUDE,
      _count: { select: { recipients: true } },
    },
  });
  if (!c) throw NotFound("bulk campaign not found");
  return c;
}

export async function createBulkCampaign(tenantId, data, createdById) {
  if (!data.name?.trim()) throw BadRequest("name required");
  if (!data.messageBody?.trim()) throw BadRequest("messageBody required");
  validateSafetyConfig(data);
  return prisma.bulkCampaign.create({
    data: {
      tenantId,
      name: data.name.trim(),
      messageBody: data.messageBody,
      mediaUrl: data.mediaUrl ?? null,
      mediaType: data.mediaType ?? null,
      scheduledAt: data.scheduledAt ?? null,
      dailyLimit: data.dailyLimit ?? 500,
      delayMin: data.delayMin ?? 30,
      delayMax: data.delayMax ?? 60,
      quietHoursStart: data.quietHoursStart ?? null,
      quietHoursEnd: data.quietHoursEnd ?? null,
      skipRepliedHours: data.skipRepliedHours ?? 0,
      createdById: createdById ?? null,
    },
    include: LIST_INCLUDE,
  });
}

export async function updateBulkCampaign(tenantId, id, data) {
  const existing = await prisma.bulkCampaign.findFirst({ where: { id, tenantId } });
  if (!existing) throw NotFound("bulk campaign not found");
  // Only DRAFT and PAUSED bulks accept content edits; the rest are
  // frozen so the audience snapshot stays meaningful.
  if (!["DRAFT", "PAUSED"].includes(existing.status)) {
    throw BadRequest(`cannot edit a ${existing.status} bulk campaign`);
  }
  validateSafetyConfig(data);
  return prisma.bulkCampaign.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.messageBody !== undefined ? { messageBody: data.messageBody } : {}),
      ...(data.mediaUrl !== undefined ? { mediaUrl: data.mediaUrl } : {}),
      ...(data.mediaType !== undefined ? { mediaType: data.mediaType } : {}),
      ...(data.scheduledAt !== undefined ? { scheduledAt: data.scheduledAt } : {}),
      ...(data.dailyLimit !== undefined ? { dailyLimit: data.dailyLimit } : {}),
      ...(data.delayMin !== undefined ? { delayMin: data.delayMin } : {}),
      ...(data.delayMax !== undefined ? { delayMax: data.delayMax } : {}),
      ...(data.quietHoursStart !== undefined ? { quietHoursStart: data.quietHoursStart } : {}),
      ...(data.quietHoursEnd !== undefined ? { quietHoursEnd: data.quietHoursEnd } : {}),
      ...(data.skipRepliedHours !== undefined ? { skipRepliedHours: data.skipRepliedHours } : {}),
    },
    include: LIST_INCLUDE,
  });
}

export async function deleteBulkCampaign(tenantId, id) {
  const existing = await prisma.bulkCampaign.findFirst({ where: { id, tenantId } });
  if (!existing) throw NotFound("bulk campaign not found");
  if (existing.isSystem) throw BadRequest("system bulk campaign cannot be deleted");
  if (existing.status === "RUNNING") {
    throw BadRequest("cannot delete a RUNNING bulk — cancel first");
  }
  await prisma.bulkCampaign.delete({ where: { id } });
  return { ok: true };
}

function validateSafetyConfig(data) {
  if (data.delayMin != null && data.delayMax != null && data.delayMin > data.delayMax) {
    throw BadRequest("delayMin must be ≤ delayMax");
  }
  if (data.dailyLimit != null && data.dailyLimit < 1) {
    throw BadRequest("dailyLimit must be ≥ 1");
  }
  for (const k of ["quietHoursStart", "quietHoursEnd"]) {
    const v = data[k];
    if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
      throw BadRequest(`${k} must be HH:MM (24-hour)`);
    }
  }
  if (
    (data.quietHoursStart && !data.quietHoursEnd) ||
    (!data.quietHoursStart && data.quietHoursEnd)
  ) {
    throw BadRequest("quiet hours must specify both start AND end");
  }
}

// ─── Audience management ────────────────────────────────────────────

export async function addRecipientsByContactIds(tenantId, bulkId, contactIds) {
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    throw BadRequest("contactIds required");
  }
  const bulk = await prisma.bulkCampaign.findFirst({ where: { id: bulkId, tenantId } });
  if (!bulk) throw NotFound("bulk campaign not found");
  if (!["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "PAUSED"].includes(bulk.status)) {
    throw BadRequest(`cannot modify audience of a ${bulk.status} bulk`);
  }
  // Validate contacts belong to the tenant + are not soft-deleted.
  const valid = await prisma.contact.findMany({
    where: { id: { in: contactIds }, tenantId, deletedAt: null },
    select: { id: true },
  });
  const validIds = new Set(valid.map((c) => c.id));
  const rows = contactIds
    .filter((id) => validIds.has(id))
    .map((id) => ({ bulkCampaignId: bulkId, contactId: id }));
  if (rows.length === 0) {
    return { added: 0, skipped: contactIds.length };
  }
  // Skip duplicates via the (bulkCampaignId, contactId) unique constraint.
  const result = await prisma.bulkCampaignRecipient.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return { added: result.count, skipped: contactIds.length - result.count };
}

// Resolve a filter expression to a list of contact IDs (audience preview).
// The filter shape mirrors the contacts list endpoint to keep the UI
// simple: { search?, source?, ownerId?, tagIds?, limit? }. Mainly used by
// the UI to "Add all matching contacts" without round-tripping CSV.
export async function resolveAudienceFilter(tenantId, filter = {}) {
  const { search, source, limit = 1000 } = filter;
  const where = {
    tenantId,
    deletedAt: null,
    ...(source ? { source } : {}),
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { mobile: { contains: search } },
            { email: { contains: search, mode: "insensitive" } },
            { company: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const ids = await prisma.contact.findMany({
    where,
    select: { id: true },
    take: Math.min(Math.max(Number(limit) || 1000, 1), 10000),
  });
  return ids.map((c) => c.id);
}

export async function listRecipients(tenantId, bulkId, opts = {}) {
  const { status, page = 1, pageSize = 50 } = opts;
  const bulk = await prisma.bulkCampaign.findFirst({ where: { id: bulkId, tenantId } });
  if (!bulk) throw NotFound("bulk campaign not found");

  const where = {
    bulkCampaignId: bulkId,
    ...(status ? { status } : {}),
  };
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const [items, total] = await Promise.all([
    prisma.bulkCampaignRecipient.findMany({
      where,
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, mobile: true, email: true, company: true },
        },
      },
      orderBy: { createdAt: "asc" },
      skip,
      take,
    }),
    prisma.bulkCampaignRecipient.count({ where }),
  ]);
  return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
}

export async function removeRecipient(tenantId, bulkId, recipientId) {
  const bulk = await prisma.bulkCampaign.findFirst({ where: { id: bulkId, tenantId } });
  if (!bulk) throw NotFound("bulk campaign not found");
  if (!["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "PAUSED"].includes(bulk.status)) {
    throw BadRequest(`cannot modify audience of a ${bulk.status} bulk`);
  }
  await prisma.bulkCampaignRecipient.deleteMany({
    where: { id: recipientId, bulkCampaignId: bulkId, status: "PENDING" },
  });
  return { ok: true };
}

// ─── Approval flow + lifecycle transitions ──────────────────────────

export async function submitForApproval(tenantId, id) {
  const bulk = await assertOwned(tenantId, id);
  if (bulk.status !== "DRAFT") throw BadRequest(`cannot submit ${bulk.status}`);
  const recipientCount = await prisma.bulkCampaignRecipient.count({
    where: { bulkCampaignId: id },
  });
  if (recipientCount === 0) throw BadRequest("add at least one recipient before submitting");
  return prisma.bulkCampaign.update({
    where: { id },
    data: { status: "PENDING_APPROVAL" },
    include: LIST_INCLUDE,
  });
}

export async function approveAndSchedule(tenantId, id, approverId, scheduledAt) {
  const bulk = await assertOwned(tenantId, id);
  if (!["DRAFT", "PENDING_APPROVAL"].includes(bulk.status)) {
    throw BadRequest(`cannot approve ${bulk.status}`);
  }
  // Safety gate: warmup mode hard-caps the bulk size.
  await assertWarmupSafe(tenantId, id);

  return prisma.bulkCampaign.update({
    where: { id },
    data: {
      status: "SCHEDULED",
      approvedById: approverId ?? null,
      approvedAt: new Date(),
      ...(scheduledAt ? { scheduledAt } : bulk.scheduledAt ? {} : { scheduledAt: new Date() }),
    },
    include: LIST_INCLUDE,
  });
}

export async function pauseBulkCampaign(tenantId, id) {
  const bulk = await assertOwned(tenantId, id);
  if (!["SCHEDULED", "RUNNING"].includes(bulk.status)) {
    throw BadRequest(`cannot pause ${bulk.status}`);
  }
  return prisma.bulkCampaign.update({
    where: { id },
    data: { status: "PAUSED" },
    include: LIST_INCLUDE,
  });
}

export async function resumeBulkCampaign(tenantId, id) {
  const bulk = await assertOwned(tenantId, id);
  if (bulk.status !== "PAUSED") throw BadRequest(`cannot resume ${bulk.status}`);
  return prisma.bulkCampaign.update({
    where: { id },
    data: { status: "SCHEDULED" },
    include: LIST_INCLUDE,
  });
}

export async function cancelBulkCampaign(tenantId, id) {
  const bulk = await assertOwned(tenantId, id);
  if (["COMPLETED", "CANCELLED"].includes(bulk.status)) {
    throw BadRequest(`already ${bulk.status}`);
  }
  return prisma.bulkCampaign.update({
    where: { id },
    data: { status: "CANCELLED", completedAt: new Date() },
    include: LIST_INCLUDE,
  });
}

async function assertOwned(tenantId, id) {
  const bulk = await prisma.bulkCampaign.findFirst({ where: { id, tenantId } });
  if (!bulk) throw NotFound("bulk campaign not found");
  return bulk;
}

async function assertWarmupSafe(tenantId, bulkId) {
  const cfg = await getSettings(tenantId, ["wa.warmup_mode"]);
  if (cfg["wa.warmup_mode"] !== true) return;
  const count = await prisma.bulkCampaignRecipient.count({
    where: { bulkCampaignId: bulkId, status: { in: ["PENDING", "QUEUED"] } },
  });
  // Hard cap: 20 pending recipients while warmup mode is on. Encoded
  // here so the API rejects even if UI is bypassed.
  if (count > 20) {
    throw BadRequest(
      `warmup mode is ON — bulk audience capped at 20 (you have ${count}). Disable warmup or trim the audience.`,
    );
  }
}

// ─── Analytics roll-up ──────────────────────────────────────────────
// Cheap counter pull from the campaign row + a real-time aggregate over
// recipients (in case the denormalized counters drift due to a missed ack).

export async function getBulkAnalytics(tenantId, id) {
  const bulk = await prisma.bulkCampaign.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      sentCount: true,
      deliveredCount: true,
      readCount: true,
      failedCount: true,
      repliedCount: true,
      _count: { select: { recipients: true } },
    },
  });
  if (!bulk) throw NotFound("bulk campaign not found");

  // Cross-check from the recipients table (authoritative).
  const grouped = await prisma.bulkCampaignRecipient.groupBy({
    by: ["status"],
    where: { bulkCampaignId: id },
    _count: true,
  });
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count]));

  return {
    id: bulk.id,
    name: bulk.name,
    status: bulk.status,
    total: bulk._count.recipients,
    pending: counts.PENDING ?? 0,
    queued: counts.QUEUED ?? 0,
    sent: counts.SENT ?? 0,
    delivered: counts.DELIVERED ?? 0,
    read: counts.READ ?? 0,
    failed: counts.FAILED ?? 0,
    replied: counts.REPLIED ?? 0,
  };
}
