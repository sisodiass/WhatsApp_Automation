import { z } from "zod";
import { asyncHandler, BadRequest, Unauthorized } from "../../shared/errors.js";
import {
  getWidgetConfig,
  initChat,
  leadCapture,
  pollChatMessages,
  sendChatMessage,
  startWidgetSession,
  verifyWidgetSession,
} from "./public.service.js";

const sessionStartSchema = z.object({
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  email: z.string().max(200).optional(),
  mobile: z.string().max(40).optional(),
  phone: z.string().max(40).optional(),
  source: z.string().max(80).optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  utm_source: z.string().max(200).optional(),
  utm_medium: z.string().max(200).optional(),
  utm_campaign: z.string().max(200).optional(),
  adId: z.string().max(200).optional(),
  ad_id: z.string().max(200).optional(),
  landingPage: z.string().max(2048).optional(),
  landing_page: z.string().max(2048).optional(),
  referrer: z.string().max(2048).optional(),
});

const leadCaptureSchema = sessionStartSchema.extend({
  name: z.string().max(240).optional(),
  message: z.string().max(4000).optional(),
  company: z.string().max(240).optional(),
  customFields: z.record(z.any()).optional(),
});

const chatSendSchema = z.object({
  body: z.string().min(1).max(4000),
});

// Pull session token out of Authorization header. Public chat endpoints
// after session start require this — separate from the X-Api-Key the
// middleware already validated.
function widgetSessionFromReq(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) throw Unauthorized("missing widget session");
  const claims = verifyWidgetSession(token);
  // Token must have been issued for the SAME integration that just
  // passed validatePublicApiKey. Prevents key/token mix-and-match.
  if (claims.iid !== req.integration.id) throw Unauthorized("session does not belong to this api key");
  return claims;
}

// Normalize the two snake/camel variants of UTM fields into a single
// shape before the service layer sees them.
function normalizeUtm(parsed) {
  return {
    ...parsed,
    utmSource: parsed.utmSource || parsed.utm_source,
    utmMedium: parsed.utmMedium || parsed.utm_medium,
    utmCampaign: parsed.utmCampaign || parsed.utm_campaign,
    adId: parsed.adId || parsed.ad_id,
    landingPage: parsed.landingPage || parsed.landing_page,
  };
}

export const widgetConfig = asyncHandler(async (req, res) => {
  res.json(getWidgetConfig(req.integration));
});

export const widgetSession = asyncHandler(async (req, res) => {
  const parsed = sessionStartSchema.safeParse(req.body || {});
  if (!parsed.success) throw BadRequest("invalid payload", parsed.error.flatten());
  const out = await startWidgetSession(req.integration, normalizeUtm(parsed.data));
  res.status(201).json(out);
});

export const chatInit = asyncHandler(async (req, res) => {
  const parsed = sessionStartSchema.safeParse(req.body || {});
  if (!parsed.success) throw BadRequest("invalid payload", parsed.error.flatten());
  const out = await initChat(req.integration, normalizeUtm(parsed.data));
  res.status(201).json(out);
});

export const chatSend = asyncHandler(async (req, res) => {
  const parsed = chatSendSchema.safeParse(req.body || {});
  if (!parsed.success) throw BadRequest("body required", parsed.error.flatten());
  const claims = widgetSessionFromReq(req);
  const msg = await sendChatMessage(req.integration, claims.sid, parsed.data.body);
  res.status(201).json(msg);
});

export const chatPoll = asyncHandler(async (req, res) => {
  const claims = widgetSessionFromReq(req);
  const items = await pollChatMessages(req.integration, claims.sid, req.query.since?.toString());
  res.json({ items });
});

export const lead = asyncHandler(async (req, res) => {
  const parsed = leadCaptureSchema.safeParse(req.body || {});
  if (!parsed.success) throw BadRequest("invalid payload", parsed.error.flatten());
  const out = await leadCapture(req.integration, normalizeUtm(parsed.data));
  res.status(201).json(out);
});
