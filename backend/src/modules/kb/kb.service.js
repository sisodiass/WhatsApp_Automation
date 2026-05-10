import { prisma } from "../../shared/prisma.js";
import { NotFound } from "../../shared/errors.js";

// ─── KB Groups ───────────────────────────────────────────────────────

export function listKbGroups(tenantId) {
  return prisma.kbGroup.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { documents: true } },
    },
  });
}

export async function getKbGroup(tenantId, id) {
  const g = await prisma.kbGroup.findUnique({
    where: { id },
    include: { _count: { select: { documents: true } } },
  });
  if (!g || g.tenantId !== tenantId) throw NotFound("kb group not found");
  return g;
}

export async function createKbGroup(tenantId, input) {
  return prisma.kbGroup.create({
    data: {
      tenantId,
      name: input.name,
      description: input.description || null,
      confidenceThreshold: input.confidenceThreshold ?? 0.82,
    },
  });
}

export async function updateKbGroup(tenantId, id, input) {
  await getKbGroup(tenantId, id);
  return prisma.kbGroup.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.confidenceThreshold !== undefined
        ? { confidenceThreshold: input.confidenceThreshold }
        : {}),
    },
  });
}

export async function deleteKbGroup(tenantId, id) {
  await getKbGroup(tenantId, id);
  await prisma.kbGroup.delete({ where: { id } });
  return { ok: true };
}

// ─── Documents ───────────────────────────────────────────────────────

export function listDocuments(tenantId, kbGroupId) {
  return prisma.kbDocument.findMany({
    where: { kbGroupId, kbGroup: { tenantId } },
    orderBy: [{ filename: "asc" }, { version: "desc" }],
    include: {
      _count: { select: { chunks: true } },
      uploadedBy: { select: { id: true, email: true } },
    },
  });
}

export async function getDocument(tenantId, id) {
  const d = await prisma.kbDocument.findUnique({
    where: { id },
    include: { kbGroup: true },
  });
  if (!d || d.kbGroup.tenantId !== tenantId) throw NotFound("document not found");
  return d;
}

// Lightweight versioning (A4): if a doc with the same filename is already
// active in this group, deactivate it and bump version. Old chunks stay
// in pgvector but retrieval filters on is_active so they're invisible.
export async function createDocumentVersion({ tenantId, kbGroupId, filename, filePath, uploadedById }) {
  // Validate the group belongs to the tenant.
  await getKbGroup(tenantId, kbGroupId);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.kbDocument.findFirst({
      where: { kbGroupId, filename, isActive: true },
      orderBy: { version: "desc" },
    });
    let version = 1;
    if (existing) {
      await tx.kbDocument.update({ where: { id: existing.id }, data: { isActive: false } });
      version = existing.version + 1;
    }
    return tx.kbDocument.create({
      data: {
        kbGroupId,
        filename,
        filePath,
        uploadedById: uploadedById || null,
        status: "PENDING",
        version,
        isActive: true,
      },
    });
  });
}

export async function setDocumentStatus(id, status, errorMessage = null) {
  return prisma.kbDocument.update({
    where: { id },
    data: { status, errorMessage },
  });
}

export async function deleteDocument(tenantId, id) {
  await getDocument(tenantId, id);
  await prisma.kbDocument.delete({ where: { id } });
  // File on disk is left in place — orphaned files are harmless and a future
  // cleanup job can sweep them.
  return { ok: true };
}
