// Service layer for the /public/* endpoints.
//
// All inbound channels MUST go through ensureLeadForContact() — this is
// the single source of truth promised by the spec. The service composes
// Contact upsert + Chat upsert + Message persist + lead auto-creation.

import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { prisma } from "../../shared/prisma.js";
import { BadRequest, Unauthorized } from "../../shared/errors.js";
import { config } from "../../config/index.js";
import { emitChatMessage } from "../../shared/socket.js";
import { ensureLeadForContact } from "../leads/lead.service.js";

const WIDGET_AUDIENCE = "sa-public-widget";
const WIDGET_TTL = "24h";

export function signWidgetSession(sessionId, tenantId, integrationId) {
  return jwt.sign(
    { sid: sessionId, tid: tenantId, iid: integrationId },
    config.jwt.secret,
    { audience: WIDGET_AUDIENCE, expiresIn: WIDGET_TTL },
  );
}

export function verifyWidgetSession(token) {
  try {
    return jwt.verify(token, config.jwt.secret, { audience: WIDGET_AUDIENCE });
  } catch {
    throw Unauthorized("invalid or expired widget session");
  }
}

// ─── /public/widget/config ──────────────────────────────────────────
// Returns the customer-facing widget appearance + behavior config. No
// auth beyond the API key — the widget script needs to read this on
// page load before the visitor has done anything.
export function getWidgetConfig(integration) {
  const cfg = integration.widgetConfig || {};
  return {
    integrationId: integration.id,
    name: integration.name,
    widgetEnabled: integration.widgetEnabled,
    // Sensible defaults so a blank widgetConfig still renders sensibly.
    primaryColor: cfg.primaryColor || "#2563eb",
    position: cfg.position || "bottom-right",
    welcomeText: cfg.welcomeText || "Hi 👋 — how can we help?",
    placeholder: cfg.placeholder || "Type a message…",
    whatsappNumber: cfg.whatsappNumber || null,
    logo: cfg.logo || null,
    requireEmail: !!cfg.requireEmail,
    requirePhone: !!cfg.requirePhone,
    headerTitle: cfg.headerTitle || "Chat with us",
    headerSubtitle: cfg.headerSubtitle || null,
    locale: cfg.locale || "en",
  };
}

// ─── /public/widget/session ─────────────────────────────────────────
// Bootstrap a widget visit. The visitor may be totally anonymous (no
// name/email/mobile) — in that case we mint an ephemeral contact whose
// "mobile" is `wc_<hex>` and revisit-merging is the caller's job.
//
// Returns a session token the widget uses for subsequent /chat/* calls.
export async function startWidgetSession(integration, opts = {}) {
  const tenantId = integration.tenantId;

  // Resolve WEB_CHAT channel.
  let channel = await prisma.channel.findUnique({
    where: { tenantId_type: { tenantId, type: "WEB_CHAT" } },
  });
  if (!channel) {
    channel = await prisma.channel.create({
      data: { tenantId, type: "WEB_CHAT", name: "Web Chat" },
    });
  }

  const mobile = sanitizeMobile(opts.mobile);
  const email = sanitizeEmail(opts.email);
  const ephemeralPhone = mobile || `wc_${crypto.randomBytes(8).toString("hex")}`;

  // Find/create contact. Mobile-keyed if real.
  let contact;
  if (mobile) {
    contact = await prisma.contact.upsert({
      where: { tenantId_mobile: { tenantId, mobile } },
      create: {
        tenantId, mobile,
        firstName: opts.firstName ?? null,
        lastName: opts.lastName ?? null,
        email: email ?? null,
        source: opts.source || "website",
      },
      update: {
        ...(opts.firstName ? { firstName: opts.firstName } : {}),
        ...(opts.lastName ? { lastName: opts.lastName } : {}),
        ...(email ? { email } : {}),
      },
    });
  } else if (email) {
    // Try to find an existing contact by email so a returning visitor
    // who supplies email-only doesn't make a duplicate.
    const existing = await prisma.contact.findFirst({
      where: { tenantId, email, deletedAt: null },
    });
    if (existing) {
      contact = existing;
    } else {
      contact = await prisma.contact.create({
        data: {
          tenantId, mobile: ephemeralPhone,
          firstName: opts.firstName ?? null,
          lastName: opts.lastName ?? null,
          email,
          source: opts.source || "website",
        },
      });
    }
  } else {
    contact = await prisma.contact.create({
      data: {
        tenantId, mobile: ephemeralPhone,
        source: opts.source || "website",
      },
    });
  }

  // Upsert chat; reuse the contact's existing web-chat chat if any.
  const chatPhone = mobile || ephemeralPhone;
  const chat = await prisma.chat.upsert({
    where: { tenantId_phone: { tenantId, phone: chatPhone } },
    create: {
      tenantId, phone: chatPhone,
      contactId: contact.id, channelId: channel.id,
      displayName: [opts.firstName, opts.lastName].filter(Boolean).join(" ") || null,
    },
    update: { channelId: channel.id, contactId: contact.id },
  });

  // Always start a new session — the widget treats each browser visit
  // as its own session for simplicity.
  const session = await prisma.chatSession.create({
    data: { chatId: chat.id, state: "ACTIVE", mode: "AI" },
  });

  // Central lead-create. Idempotent; first-touch UTMs only.
  await ensureLeadForContact(tenantId, contact.id, opts.source || "website", {
    utmSource: opts.utmSource,
    utmMedium: opts.utmMedium,
    utmCampaign: opts.utmCampaign,
    adId: opts.adId,
    landingPage: opts.landingPage,
    referrer: opts.referrer,
  });

  return {
    sessionToken: signWidgetSession(session.id, tenantId, integration.id),
    sessionId: session.id,
    chatId: chat.id,
    visitorId: contact.id, // alias for the widget's localStorage
  };
}

// ─── /public/chat/init ──────────────────────────────────────────────
// Identical to widget session start but exposed as a separate endpoint
// for symmetry with the spec. Widgets typically call /widget/session;
// programmatic chat clients use /chat/init. Same return shape.
export async function initChat(integration, opts = {}) {
  return startWidgetSession(integration, opts);
}

// ─── /public/chat/send ──────────────────────────────────────────────
// Visitor sends a message in a previously-started session. Session
// token gates this call; the integration claim must match the token
// to prevent cross-integration replay.
export async function sendChatMessage(integration, sessionId, body) {
  const trimmed = (body || "").toString().trim();
  if (!trimmed) throw BadRequest("body required");
  if (trimmed.length > 4000) throw BadRequest("body too long");

  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: { chat: true },
  });
  if (!session || session.endedAt) throw BadRequest("session ended");
  if (session.chat.tenantId !== integration.tenantId) {
    throw Unauthorized("session does not belong to this api key");
  }

  const msg = await prisma.message.create({
    data: {
      sessionId,
      direction: "IN",
      source: "CUSTOMER",
      body: trimmed,
      kbChunkIds: [],
    },
  });
  await prisma.chat.update({
    where: { id: session.chatId },
    data: { lastMessageAt: new Date() },
  });
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

// Visitor polls for replies in their session.
export async function pollChatMessages(integration, sessionId, since) {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { chat: { select: { tenantId: true } } },
  });
  if (!session || session.chat.tenantId !== integration.tenantId) {
    throw Unauthorized("session does not belong to this api key");
  }
  const items = await prisma.message.findMany({
    where: {
      sessionId,
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
    },
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

// ─── /public/lead-capture ───────────────────────────────────────────
// One-shot form-style endpoint. The form site posts a payload, we
// upsert the Contact, optionally save the first message, and call
// ensureLeadForContact. Returns the contact + lead + chat session
// (in case the calling site wants to follow up with live chat).
//
// The spec's bare-minimum payload: { apiKey, name, phone, email,
// message, source, utm_*, referrer, landingPage }. We accept either
// "phone" or "mobile" since field naming varies wildly across form
// builders.
export async function leadCapture(integration, opts) {
  const tenantId = integration.tenantId;

  const mobile = sanitizeMobile(opts.phone || opts.mobile);
  const email = sanitizeEmail(opts.email);
  if (!mobile && !email) {
    throw BadRequest("phone or email is required");
  }

  // Split name into first/last best-effort.
  const { firstName, lastName } = splitName(opts.name);

  // Upsert contact — prefer mobile key, fall back to email lookup.
  let contact;
  if (mobile) {
    contact = await prisma.contact.upsert({
      where: { tenantId_mobile: { tenantId, mobile } },
      create: {
        tenantId, mobile,
        firstName, lastName, email,
        company: opts.company || null,
        source: opts.source || "website",
        customFields: pickCustomFields(opts.customFields),
      },
      update: {
        // Don't overwrite operator-edited fields. Fill in blanks only.
        ...(firstName ? {} : {}),
      },
    });
    // Manual fill-blank step (Prisma update can't conditionally set
    // per-field — do it in a second pass when we already have the row).
    const fill = {};
    if (firstName && !contact.firstName) fill.firstName = firstName;
    if (lastName && !contact.lastName) fill.lastName = lastName;
    if (email && !contact.email) fill.email = email;
    if (opts.company && !contact.company) fill.company = opts.company;
    if (Object.keys(fill).length > 0) {
      contact = await prisma.contact.update({ where: { id: contact.id }, data: fill });
    }
  } else {
    const existing = await prisma.contact.findFirst({
      where: { tenantId, email, deletedAt: null },
    });
    if (existing) {
      contact = existing;
    } else {
      // No mobile, no existing email-keyed contact → mint with an
      // ephemeral phone (matches the widget pattern).
      const ephemeralPhone = `wc_${crypto.randomBytes(8).toString("hex")}`;
      contact = await prisma.contact.create({
        data: {
          tenantId, mobile: ephemeralPhone,
          firstName, lastName, email,
          company: opts.company || null,
          source: opts.source || "website",
          customFields: pickCustomFields(opts.customFields),
        },
      });
    }
  }

  // If the form included a message, persist it on a web-chat session.
  // Otherwise no chat row is needed — the lead can sit alone.
  let chatSessionId = null;
  if (opts.message?.trim()) {
    const session = await openWebChatSession(tenantId, contact);
    await prisma.message.create({
      data: {
        sessionId: session.id,
        direction: "IN",
        source: "CUSTOMER",
        body: opts.message.trim().slice(0, 4000),
        kbChunkIds: [],
      },
    });
    await prisma.chat.update({
      where: { id: session.chatId },
      data: { lastMessageAt: new Date() },
    });
    chatSessionId = session.id;
  }

  // The promised single source of truth.
  const lead = await ensureLeadForContact(
    tenantId,
    contact.id,
    opts.source || "api",
    {
      utmSource: opts.utm_source || opts.utmSource,
      utmMedium: opts.utm_medium || opts.utmMedium,
      utmCampaign: opts.utm_campaign || opts.utmCampaign,
      adId: opts.ad_id || opts.adId,
      landingPage: opts.landingPage || opts.landing_page,
      referrer: opts.referrer,
    },
  );

  return { contact, lead, chatSessionId };
}

// ─── helpers ───────────────────────────────────────────────────────

async function openWebChatSession(tenantId, contact) {
  let channel = await prisma.channel.findUnique({
    where: { tenantId_type: { tenantId, type: "WEB_CHAT" } },
  });
  if (!channel) {
    channel = await prisma.channel.create({
      data: { tenantId, type: "WEB_CHAT", name: "Web Chat" },
    });
  }
  const chat = await prisma.chat.upsert({
    where: { tenantId_phone: { tenantId, phone: contact.mobile } },
    create: {
      tenantId, phone: contact.mobile,
      contactId: contact.id, channelId: channel.id,
      displayName: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null,
    },
    update: { contactId: contact.id, channelId: channel.id },
  });
  let session = await prisma.chatSession.findFirst({
    where: { chatId: chat.id, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!session) {
    session = await prisma.chatSession.create({
      data: { chatId: chat.id, state: "ACTIVE", mode: "AI" },
    });
  }
  return { id: session.id, chatId: chat.id };
}

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

function splitName(full) {
  if (!full || !String(full).trim()) return { firstName: null, lastName: null };
  const parts = String(full).trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function pickCustomFields(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  // Reject keys that collide with first-class columns to avoid confusion.
  const reserved = new Set([
    "firstName", "lastName", "mobile", "email", "company", "source",
    "phone", "name", "tenantId", "id",
  ]);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (reserved.has(k)) continue;
    if (k.length > 60) continue;
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v.slice(0, 500) : v;
  }
  return Object.keys(out).length ? out : null;
}
