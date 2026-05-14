// Web-chat widget public API. Anonymous users hit /api/widget/v1/* with
// either a bootstrap call (start) or a per-session token (send/poll).
//
// Session tokens are short-lived JWTs signed with the same JWT_SECRET as
// agent auth but a distinct audience ("sa-widget"). They carry the chat
// session id so the widget can talk back-and-forth without ever knowing
// any internal IDs beyond its own session.
//
// Flow:
//   1. POST /widget/v1/start { name?, email?, mobile?, utm... }
//        → upserts Contact (by email if provided, else mobile if provided,
//          else creates an ephemeral mobile-less contact), creates/finds
//          a Chat on the WEB_CHAT channel, opens a ChatSession, creates
//          a Lead (with utm_* captured). Returns { sessionToken, sessionId }.
//   2. POST /widget/v1/messages { body }   (Authorization: Bearer sessionToken)
//        → writes an inbound Message, returns it.
//   3. GET  /widget/v1/messages?since      (Authorization: Bearer sessionToken)
//        → returns messages since the given ISO timestamp, both directions.
//
// The widget has NO Bull/AI hooks here — agents reply via the regular Inbox
// (which sees WEB_CHAT sessions just like any other). Future M10 work can
// auto-attach a default campaign + KB groups for AI replies.

import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { prisma } from "../../shared/prisma.js";
import { BadRequest, Unauthorized } from "../../shared/errors.js";
import { config } from "../../config/index.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import { emitChatMessage } from "../../shared/socket.js";
import { ensureLeadForContact } from "../leads/lead.service.js";

const WIDGET_AUDIENCE = "sa-widget";
const WIDGET_TTL = "24h";

export function signSessionToken(sessionId, tenantId) {
  return jwt.sign({ sid: sessionId, tid: tenantId }, config.jwt.secret, {
    audience: WIDGET_AUDIENCE,
    expiresIn: WIDGET_TTL,
  });
}

export function verifySessionToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret, { audience: WIDGET_AUDIENCE });
  } catch {
    throw Unauthorized("invalid or expired widget session");
  }
}

// ─── start ────────────────────────────────────────────────────────

export async function startSession(opts = {}) {
  const tenantId = await getDefaultTenantId();

  // Find or create the WEB_CHAT channel — should be seeded but defensive.
  let channel = await prisma.channel.findUnique({
    where: { tenantId_type: { tenantId, type: "WEB_CHAT" } },
  });
  if (!channel) {
    channel = await prisma.channel.create({
      data: { tenantId, type: "WEB_CHAT", name: "Web Chat" },
    });
  }

  // Stable per-visitor identity. If a real mobile/email is provided we
  // use those to dedup the contact. Otherwise we mint an ephemeral
  // "wc_<random>" id used as the chat.phone (chat.phone is a free-form
  // string per tenant; only the WhatsApp inbound path enforces E.164).
  const mobile = sanitizeMobile(opts.mobile);
  const email = sanitizeEmail(opts.email);
  const ephemeralPhone = mobile || `wc_${crypto.randomBytes(8).toString("hex")}`;

  // Upsert contact. Mobile-keyed if real; otherwise create a fresh row.
  let contact;
  if (mobile) {
    contact = await prisma.contact.upsert({
      where: { tenantId_mobile: { tenantId, mobile } },
      create: {
        tenantId, mobile,
        firstName: opts.firstName ?? null,
        lastName: opts.lastName ?? null,
        email: email ?? null,
        source: opts.source || "web_chat",
      },
      update: {
        ...(opts.firstName ? { firstName: opts.firstName } : {}),
        ...(opts.lastName ? { lastName: opts.lastName } : {}),
        ...(email ? { email } : {}),
      },
    });
  } else {
    contact = await prisma.contact.create({
      data: {
        tenantId, mobile: ephemeralPhone,
        firstName: opts.firstName ?? null,
        lastName: opts.lastName ?? null,
        email: email ?? null,
        source: opts.source || "web_chat",
      },
    });
  }

  // Open a chat for this contact on the WEB_CHAT channel. We dedup by
  // (tenantId, phone) per the existing Chat unique constraint.
  const chat = await prisma.chat.upsert({
    where: { tenantId_phone: { tenantId, phone: ephemeralPhone } },
    create: {
      tenantId, phone: ephemeralPhone,
      contactId: contact.id, channelId: channel.id,
      displayName: [opts.firstName, opts.lastName].filter(Boolean).join(" ") || null,
    },
    update: {
      // First chat may have been created without a channel link.
      channelId: channel.id,
      contactId: contact.id,
    },
  });

  // Always start a fresh session for the widget. Multiple browser tabs
  // are rare and result in two short-lived sessions; that's fine.
  const session = await prisma.chatSession.create({
    data: { chatId: chat.id, state: "ACTIVE", mode: "AI" },
  });

  // Lead — delegated to the central helper so all inbound channels
  // share the same idempotency + attribution logic. First-touch UTMs
  // are passed as metadata and only land on the first auto-create
  // (helper short-circuits on subsequent calls).
  await ensureLeadForContact(tenantId, contact.id, opts.source || "webchat", {
    utmSource: opts.utmSource,
    utmMedium: opts.utmMedium,
    utmCampaign: opts.utmCampaign,
    adId: opts.adId,
    landingPage: opts.landingPage,
    referrer: opts.referrer,
  });

  return {
    sessionToken: signSessionToken(session.id, tenantId),
    sessionId: session.id,
    chatId: chat.id,
  };
}

// ─── messages ──────────────────────────────────────────────────────

export async function sendWidgetMessage(sessionId, body) {
  const trimmed = (body || "").trim();
  if (!trimmed) throw BadRequest("body required");
  if (trimmed.length > 4000) throw BadRequest("body too long");

  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: { chat: true },
  });
  if (!session || session.endedAt) throw BadRequest("session ended");

  const msg = await prisma.message.create({
    data: {
      sessionId,
      direction: "IN",
      source: "CUSTOMER",
      body: trimmed,
      kbChunkIds: [],
    },
  });
  // Touch the chat's last-activity timestamp so M5 follow-up + the
  // chat-list sort stay correct.
  await prisma.chat.update({
    where: { id: session.chatId },
    data: { lastMessageAt: new Date() },
  });

  // Push to the admin socket channel so the open Inbox / Chat view
  // shows the message live. Per memory rule, socket scope is chat + QR
  // only — this is the chat path.
  emitChatMessage({
    id: msg.id,
    sessionId: msg.sessionId,
    chatId: session.chatId,
    direction: msg.direction,
    source: msg.source,
    body: msg.body,
    createdAt: msg.createdAt,
  });

  return msg;
}

export async function pollMessages(sessionId, since) {
  const where = {
    sessionId,
    ...(since ? { createdAt: { gt: new Date(since) } } : {}),
  };
  const items = await prisma.message.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      direction: true,
      source: true,
      body: true,
      createdAt: true,
      sentAt: true,
    },
  });
  return items;
}

// ─── helpers ───────────────────────────────────────────────────────

const MOBILE_RE = /^(\d{7,20}|\d{6,20}@lid)$/;
function sanitizeMobile(raw) {
  if (!raw) return null;
  const cleaned = String(raw).trim().replace(/^\+/, "").replace(/[\s\-().]/g, "");
  return MOBILE_RE.test(cleaned) ? cleaned : null;
}

function sanitizeEmail(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}
