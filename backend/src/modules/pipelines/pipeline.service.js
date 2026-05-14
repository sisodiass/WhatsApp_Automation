import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";

export function listPipelines(tenantId) {
  return prisma.pipeline.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: {
      stages: { orderBy: { order: "asc" } },
      _count: { select: { leads: true } },
    },
  });
}

export async function getPipeline(tenantId, id) {
  const p = await prisma.pipeline.findFirst({
    where: { id, tenantId },
    include: {
      stages: { orderBy: { order: "asc" } },
      _count: { select: { leads: true } },
    },
  });
  if (!p) throw NotFound("pipeline not found");
  return p;
}

export async function createPipeline(tenantId, { name, isDefault = false }) {
  if (!name?.trim()) throw BadRequest("name required");
  return prisma.$transaction(async (tx) => {
    if (isDefault) {
      // Only one default per tenant.
      await tx.pipeline.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.pipeline.create({
      data: { tenantId, name: name.trim(), isDefault, isSystem: false },
      include: { stages: true },
    });
  });
}

export async function updatePipeline(tenantId, id, { name, isDefault }) {
  const existing = await prisma.pipeline.findFirst({ where: { id, tenantId } });
  if (!existing) throw NotFound("pipeline not found");

  return prisma.$transaction(async (tx) => {
    if (isDefault === true) {
      await tx.pipeline.updateMany({
        where: { tenantId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return tx.pipeline.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
      },
      include: { stages: { orderBy: { order: "asc" } } },
    });
  });
}

export async function deletePipeline(tenantId, id) {
  const existing = await prisma.pipeline.findFirst({ where: { id, tenantId } });
  if (!existing) throw NotFound("pipeline not found");
  if (existing.isSystem) throw BadRequest("system pipeline cannot be deleted");
  // Leads cascade via FK; stages cascade via FK.
  await prisma.$transaction(async (tx) => {
    await tx.pipeline.delete({ where: { id } });
    if (existing.isDefault) {
      // Promote another pipeline to default so the tenant always has one.
      // Prefer the system "Sales" pipeline, otherwise oldest by createdAt.
      const next = await tx.pipeline.findFirst({
        where: { tenantId },
        orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
      });
      if (next) {
        await tx.pipeline.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
  });
  return { ok: true };
}

// ─── Stages ──────────────────────────────────────────────────────────

export async function createStage(tenantId, pipelineId, { name, order, category, color }) {
  const pipeline = await prisma.pipeline.findFirst({ where: { id: pipelineId, tenantId } });
  if (!pipeline) throw NotFound("pipeline not found");
  if (!name?.trim()) throw BadRequest("name required");

  let nextOrder = order;
  if (nextOrder === undefined || nextOrder === null) {
    const last = await prisma.stage.findFirst({
      where: { pipelineId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    nextOrder = last ? last.order + 10 : 10;
  }
  return prisma.stage.create({
    data: {
      pipelineId,
      name: name.trim(),
      order: nextOrder,
      category: category ?? "OPEN",
      color: color ?? null,
    },
  });
}

export async function updateStage(tenantId, stageId, { name, order, category, color }) {
  const stage = await prisma.stage.findUnique({
    where: { id: stageId },
    include: { pipeline: { select: { tenantId: true, isSystem: true } } },
  });
  if (!stage || stage.pipeline.tenantId !== tenantId) throw NotFound("stage not found");
  return prisma.stage.update({
    where: { id: stageId },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(order !== undefined ? { order } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(color !== undefined ? { color } : {}),
    },
  });
}

// Reorder a batch of stages atomically. Caller sends [{id, order}, ...].
export async function reorderStages(tenantId, pipelineId, updates) {
  const pipeline = await prisma.pipeline.findFirst({ where: { id: pipelineId, tenantId } });
  if (!pipeline) throw NotFound("pipeline not found");

  await prisma.$transaction(
    updates.map((u) =>
      prisma.stage.update({
        where: { id: u.id },
        data: { order: u.order },
      }),
    ),
  );
  return { ok: true };
}

export async function deleteStage(tenantId, stageId) {
  const stage = await prisma.stage.findUnique({
    where: { id: stageId },
    include: { pipeline: { select: { tenantId: true } }, _count: { select: { leads: true } } },
  });
  if (!stage || stage.pipeline.tenantId !== tenantId) throw NotFound("stage not found");
  if (stage._count.leads > 0) {
    throw BadRequest("cannot delete a stage with leads — move them first");
  }
  await prisma.stage.delete({ where: { id: stageId } });
  return { ok: true };
}
