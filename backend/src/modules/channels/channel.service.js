// Channel CRUD + per-type config. Channels are seeded for the two
// built-in types (WHATSAPP, WEB_CHAT) in seed.js; operators add
// INSTAGRAM / FB_MESSENGER configurations via the Settings UI.
//
// The `config` JSON is provider-specific:
//   INSTAGRAM    : { pageId, pageAccessToken, appSecret, verifyToken }
//   FB_MESSENGER : { pageId, pageAccessToken, appSecret, verifyToken }
//   WEB_CHAT     : (empty — widget needs no config)
//   WHATSAPP     : (empty — whatsapp-web.js auth lives in .wwebjs_auth)

import { prisma } from "../../shared/prisma.js";
import { BadRequest, NotFound } from "../../shared/errors.js";

const VALID_TYPES = new Set(["WHATSAPP", "INSTAGRAM", "FB_MESSENGER", "WEB_CHAT"]);

// Fields that must be present for a Meta channel to be usable for inbound
// (webhook) AND outbound (Graph API). Inbound alone needs verifyToken +
// appSecret; outbound alone needs pageAccessToken. We require all four.
const META_REQUIRED = ["pageId", "pageAccessToken", "appSecret", "verifyToken"];

function validateConfig(type, config) {
  if (!config) return null;
  if (type === "INSTAGRAM" || type === "FB_MESSENGER") {
    for (const k of META_REQUIRED) {
      if (config[k] !== undefined && config[k] !== null) {
        if (typeof config[k] !== "string" || !config[k].length) {
          throw BadRequest(`${k} must be a non-empty string`);
        }
      }
    }
  }
  return config;
}

export function listChannels(tenantId) {
  return prisma.channel.findMany({
    where: { tenantId },
    orderBy: { type: "asc" },
    include: { _count: { select: { chats: true } } },
  });
}

export async function getChannel(tenantId, id) {
  const c = await prisma.channel.findFirst({ where: { id, tenantId } });
  if (!c) throw NotFound("channel not found");
  return c;
}

export async function getChannelByType(tenantId, type) {
  if (!VALID_TYPES.has(type)) throw BadRequest("invalid channel type");
  return prisma.channel.findUnique({
    where: { tenantId_type: { tenantId, type } },
  });
}

// Upsert by (tenantId, type). Lets the operator add Instagram + FB
// without picking a UUID. Public reads strip secrets so the admin UI
// doesn't accidentally leak access tokens (admins can still see them
// when they edit, but we re-fetch with a different code path).
export async function upsertChannelByType(tenantId, type, data) {
  if (!VALID_TYPES.has(type)) throw BadRequest("invalid channel type");
  const config = validateConfig(type, data.config || null);
  return prisma.channel.upsert({
    where: { tenantId_type: { tenantId, type } },
    create: {
      tenantId, type,
      name: data.name || defaultName(type),
      config,
      isActive: data.isActive ?? true,
    },
    update: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.config !== undefined ? { config } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });
}

export async function deleteChannel(tenantId, id) {
  const c = await prisma.channel.findFirst({ where: { id, tenantId } });
  if (!c) throw NotFound("channel not found");
  // Don't allow deleting WHATSAPP / WEB_CHAT — they're built-ins; the
  // operator can flip isActive=false instead.
  if (c.type === "WHATSAPP" || c.type === "WEB_CHAT") {
    throw BadRequest(`cannot delete built-in ${c.type} channel; deactivate instead`);
  }
  await prisma.channel.delete({ where: { id: c.id } });
  return { ok: true };
}

function defaultName(type) {
  return {
    WHATSAPP: "WhatsApp",
    INSTAGRAM: "Instagram",
    FB_MESSENGER: "Facebook Messenger",
    WEB_CHAT: "Web Chat",
  }[type] || type;
}

// Strip secret fields when serializing for the list view. The single-item
// edit view (admin only) shows them in full.
export function redactSecrets(channel) {
  if (!channel?.config) return channel;
  const cfg = { ...channel.config };
  for (const k of ["pageAccessToken", "appSecret", "verifyToken"]) {
    if (cfg[k]) cfg[k] = "***";
  }
  return { ...channel, config: cfg };
}
