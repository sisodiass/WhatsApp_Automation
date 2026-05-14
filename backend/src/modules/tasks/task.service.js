import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";

const INCLUDE = {
  assignedTo: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true } },
  lead: {
    select: {
      id: true,
      contact: { select: { id: true, firstName: true, lastName: true, mobile: true } },
    },
  },
};

export async function listTasks(tenantId, opts = {}) {
  const { status, assignedToId, leadId, overdue, page = 1, pageSize = 50 } = opts;
  const where = {
    tenantId,
    ...(status ? { status } : {}),
    ...(assignedToId ? { assignedToId } : {}),
    ...(leadId ? { leadId } : {}),
    ...(overdue ? { status: "OPEN", dueAt: { lt: new Date() } } : {}),
  };
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

  const [items, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      skip,
      take,
    }),
    prisma.task.count({ where }),
  ]);

  return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
}

export async function getTask(tenantId, id) {
  const t = await prisma.task.findFirst({ where: { id, tenantId }, include: INCLUDE });
  if (!t) throw NotFound("task not found");
  return t;
}

export async function createTask(tenantId, data, createdById) {
  if (!data.title?.trim()) throw BadRequest("title required");
  if (data.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: data.leadId, tenantId } });
    if (!lead) throw NotFound("lead not found");
  }
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        tenantId,
        leadId: data.leadId ?? null,
        title: data.title.trim(),
        description: data.description ?? null,
        dueAt: data.dueAt ?? null,
        assignedToId: data.assignedToId ?? null,
        createdById: createdById ?? null,
      },
      include: INCLUDE,
    });
    if (task.leadId) {
      await tx.leadActivity.create({
        data: {
          leadId: task.leadId,
          kind: "TASK",
          taskId: task.id,
          actorId: createdById ?? null,
          data: { event: "task_created", title: task.title },
        },
      });
    }
    return task;
  });
}

export async function updateTask(tenantId, id, data, actorId) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.task.findFirst({ where: { id, tenantId } });
    if (!existing) throw NotFound("task not found");

    const next = { ...data };
    // Auto-set doneAt when transitioning to DONE; clear it on the way out.
    if (next.status === "DONE" && existing.status !== "DONE") {
      next.doneAt = new Date();
    } else if (next.status && next.status !== "DONE" && existing.doneAt) {
      next.doneAt = null;
    }

    const task = await tx.task.update({
      where: { id },
      data: next,
      include: INCLUDE,
    });

    // Activity entries for status flips on lead-linked tasks.
    if (task.leadId && next.status && next.status !== existing.status) {
      await tx.leadActivity.create({
        data: {
          leadId: task.leadId,
          kind: "TASK",
          taskId: task.id,
          actorId: actorId ?? null,
          data: { event: "task_status_changed", from: existing.status, to: next.status },
        },
      });
    }
    return task;
  });
}

export async function deleteTask(tenantId, id) {
  const existing = await prisma.task.findFirst({ where: { id, tenantId } });
  if (!existing) throw NotFound("task not found");
  await prisma.task.delete({ where: { id } });
  return { ok: true };
}
