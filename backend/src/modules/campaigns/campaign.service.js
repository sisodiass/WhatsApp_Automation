import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";

// Body matches a campaign tag if the message starts with the tag (case-
// insensitive, ignoring leading whitespace). Trailing text is fine — wa.me
// prefills the tag, but the customer might add more before sending.
export async function findCampaignByMessageBody(tenantId, body) {
  if (!body) return null;
  const trimmed = body.trim();
  // Pull the first whitespace-delimited token, normalize.
  const firstToken = trimmed.split(/\s+/, 1)[0]?.toUpperCase();
  if (!firstToken) return null;

  const campaign = await prisma.campaign.findUnique({ where: { tag: firstToken } });
  if (!campaign) return null;
  if (campaign.tenantId !== tenantId) return null;
  if (!campaign.isActive) return null;
  if (campaign.expiresAt && campaign.expiresAt < new Date()) return null;
  return campaign;
}

export function listCampaigns(tenantId) {
  return prisma.campaign.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: {
      kbGroups: { include: { kbGroup: { select: { id: true, name: true } } } },
      _count: { select: { chatSessions: true } },
    },
  });
}

export async function getCampaign(tenantId, id) {
  const c = await prisma.campaign.findUnique({
    where: { id },
    include: {
      kbGroups: { include: { kbGroup: { select: { id: true, name: true } } } },
    },
  });
  if (!c || c.tenantId !== tenantId) throw NotFound("campaign not found");
  return c;
}

export async function createCampaign(tenantId, input) {
  const { kbGroupIds = [], expiresAt, ...rest } = input;
  return prisma.campaign.create({
    data: {
      tenantId,
      ...rest,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      kbGroups: { create: kbGroupIds.map((kbGroupId) => ({ kbGroupId })) },
    },
    include: {
      kbGroups: { include: { kbGroup: { select: { id: true, name: true } } } },
    },
  });
}

export async function updateCampaign(tenantId, id, input) {
  const existing = await getCampaign(tenantId, id);

  const { kbGroupIds, expiresAt, ...rest } = input;
  const data = { ...rest };
  if (expiresAt !== undefined) data.expiresAt = expiresAt ? new Date(expiresAt) : null;

  // System campaigns: tag + name are locked; isSystem cannot be flipped off.
  if (existing.isSystem) {
    if (data.tag !== undefined && data.tag !== existing.tag) {
      throw BadRequest("system campaign tag is locked");
    }
    if (data.name !== undefined && data.name !== existing.name) {
      throw BadRequest("system campaign name is locked");
    }
    delete data.tag;
    delete data.name;
    delete data.isSystem;
  }

  // If kbGroupIds was provided (even empty), replace the join rows.
  if (kbGroupIds !== undefined) {
    await prisma.campaignKbGroup.deleteMany({ where: { campaignId: id } });
  }

  return prisma.campaign.update({
    where: { id },
    data: {
      ...data,
      ...(kbGroupIds !== undefined
        ? { kbGroups: { create: kbGroupIds.map((kbGroupId) => ({ kbGroupId })) } }
        : {}),
    },
    include: {
      kbGroups: { include: { kbGroup: { select: { id: true, name: true } } } },
    },
  });
}

export async function deleteCampaign(tenantId, id) {
  const existing = await getCampaign(tenantId, id);
  if (existing.isSystem) {
    throw BadRequest("system campaigns cannot be deleted");
  }
  await prisma.campaign.delete({ where: { id } });
  return { ok: true };
}
