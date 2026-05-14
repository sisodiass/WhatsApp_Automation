import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";

// All queries scope on tenantId AND deletedAt IS NULL by default. Pass
// includeDeleted=true to admin tools that legitimately need to see
// soft-deleted rows (e.g. restore UI).

const ACTIVE_WHERE = (tenantId) => ({ tenantId, deletedAt: null });

// ─── Source master (read + rename) ─────────────────────────────────
// `source` is a free-form string on both Contact and Lead, populated by
// different inbound paths (webchat, whatsapp, instagram, api, ...).
// We aggregate per-tenant for a Sources admin page and support renaming
// a source across both tables in one transaction.

export async function listSources(tenantId) {
  const [contactsBySource, leadsBySource, wonLeadsBySource] = await Promise.all([
    prisma.contact.groupBy({
      by: ["source"],
      where: { tenantId, deletedAt: null, source: { not: null } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["source"],
      where: { tenantId, source: { not: null } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["source"],
      where: {
        tenantId,
        source: { not: null },
        stage: { category: "WON" },
      },
      _count: { _all: true },
    }),
  ]);

  const map = new Map();
  function ensure(source) {
    if (!map.has(source)) {
      map.set(source, { source, contactCount: 0, leadCount: 0, wonCount: 0 });
    }
    return map.get(source);
  }
  for (const r of contactsBySource) ensure(r.source).contactCount = r._count._all;
  for (const r of leadsBySource) ensure(r.source).leadCount = r._count._all;
  for (const r of wonLeadsBySource) ensure(r.source).wonCount = r._count._all;

  return Array.from(map.values())
    .map((s) => ({
      ...s,
      conversion: s.leadCount > 0 ? Number((s.wonCount / s.leadCount).toFixed(3)) : 0,
    }))
    .sort((a, b) => (b.contactCount + b.leadCount) - (a.contactCount + a.leadCount));
}

// Bulk-rename a source value across Contact + Lead. If `to` already
// exists this MERGES the two — downstream analytics treats them as one
// from then on. Wrapped in a transaction so neither table is updated
// alone if the other fails.
export async function renameSource(tenantId, fromSource, toSource) {
  if (!fromSource || !toSource) throw BadRequest("from and to required");
  const from = String(fromSource).trim();
  const to = String(toSource).trim();
  if (!from || !to) throw BadRequest("from/to cannot be empty");
  if (from === to) return { contacts: 0, leads: 0, noop: true };

  const [contacts, leads] = await prisma.$transaction([
    prisma.contact.updateMany({
      where: { tenantId, source: from },
      data: { source: to },
    }),
    prisma.lead.updateMany({
      where: { tenantId, source: from },
      data: { source: to },
    }),
  ]);
  return { contacts: contacts.count, leads: leads.count };
}

export async function listContacts(tenantId, opts = {}) {
  const { search, source, ownerId, page = 1, pageSize = 50, includeDeleted = false } = opts;
  const where = {
    tenantId,
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(source ? { source } : {}),
    ...(ownerId ? { ownerId } : {}),
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

  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

  const [items, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        // Surface up to 3 most-recent lead IDs + stage so the Contacts
        // list can deep-link to lead detail without a follow-up query.
        // Counts come along too — most contacts have 1-2 leads max.
        leads: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: {
            id: true,
            stage: { select: { id: true, name: true, category: true } },
          },
        },
        _count: { select: { leads: true, chats: true } },
      },
    }),
    prisma.contact.count({ where }),
  ]);

  return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
}

export async function getContact(tenantId, id) {
  const contact = await prisma.contact.findFirst({
    where: { id, ...ACTIVE_WHERE(tenantId) },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      chats: {
        select: { id: true, phone: true, displayName: true, lastMessageAt: true },
        orderBy: { lastMessageAt: "desc" },
      },
      leads: {
        select: {
          id: true,
          stageId: true,
          score: true,
          assignedToId: true,
          createdAt: true,
          stage: { select: { id: true, name: true, category: true, color: true } },
          pipeline: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!contact) throw NotFound("contact not found");
  return contact;
}

export async function createContact(tenantId, data) {
  if (!data.mobile || !String(data.mobile).trim()) throw BadRequest("mobile required");
  // Canonical phone is whatever the chat.phone format is — typically a
  // digit-only E.164. We strip the leading "+" and any whitespace; further
  // normalization can land in utils/phone.js later.
  const mobile = String(data.mobile).replace(/^\+/, "").replace(/\s+/g, "");

  return prisma.contact
    .create({
      data: {
        tenantId,
        mobile,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        email: data.email ?? null,
        company: data.company ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        country: data.country ?? null,
        source: data.source ?? null,
        ownerId: data.ownerId ?? null,
        customFields: data.customFields ?? null,
      },
    })
    .catch((err) => {
      if (err.code === "P2002") throw BadRequest("a contact with this mobile already exists");
      throw err;
    });
}

export async function updateContact(tenantId, id, data) {
  const existing = await prisma.contact.findFirst({ where: { id, ...ACTIVE_WHERE(tenantId) } });
  if (!existing) throw NotFound("contact not found");

  const next = { ...data };
  if (next.mobile !== undefined) {
    next.mobile = String(next.mobile).replace(/^\+/, "").replace(/\s+/g, "");
    if (!next.mobile) throw BadRequest("mobile cannot be empty");
  }

  return prisma.contact
    .update({ where: { id }, data: next })
    .catch((err) => {
      if (err.code === "P2002") throw BadRequest("a contact with this mobile already exists");
      throw err;
    });
}

export async function softDeleteContact(tenantId, id) {
  const existing = await prisma.contact.findFirst({ where: { id, ...ACTIVE_WHERE(tenantId) } });
  if (!existing) throw NotFound("contact not found");
  await prisma.contact.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  return { ok: true };
}
