// Public widget API. NO auth on /start (anonymous visitors). /send + /poll
// require the session token issued by /start, validated by widgetAuth.
//
// Mounted under /api/widget/v1 in src/index.js. The frontend embed page
// at /widget/embed.html talks to these endpoints.

import { Router } from "express";
import { z } from "zod";
import { asyncHandler, BadRequest, Unauthorized } from "../../shared/errors.js";
import {
  pollMessages,
  sendWidgetMessage,
  startSession,
  verifySessionToken,
} from "./widget.service.js";

const startSchema = z.object({
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  email: z.string().email().optional(),
  mobile: z.string().max(40).optional(),
  source: z.string().max(80).optional(),
  utmSource: z.string().max(120).optional(),
  utmMedium: z.string().max(120).optional(),
  utmCampaign: z.string().max(120).optional(),
  adId: z.string().max(120).optional(),
  landingPage: z.string().max(500).optional(),
  referrer: z.string().max(500).optional(),
});

const sendSchema = z.object({
  body: z.string().min(1).max(4000),
});

function widgetAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return next(Unauthorized("missing widget session"));
  try {
    const payload = verifySessionToken(token);
    req.widget = { sessionId: payload.sid, tenantId: payload.tid };
    next();
  } catch (err) {
    next(err);
  }
}

export const widgetRouter = Router();

widgetRouter.post(
  "/start",
  asyncHandler(async (req, res) => {
    const parsed = startSchema.safeParse(req.body || {});
    if (!parsed.success) throw BadRequest("invalid start payload", parsed.error.flatten());
    const out = await startSession(parsed.data);
    res.status(201).json(out);
  }),
);

widgetRouter.post(
  "/messages",
  widgetAuth,
  asyncHandler(async (req, res) => {
    const parsed = sendSchema.safeParse(req.body || {});
    if (!parsed.success) throw BadRequest("body required", parsed.error.flatten());
    const m = await sendWidgetMessage(req.widget.sessionId, parsed.data.body);
    res.status(201).json(m);
  }),
);

widgetRouter.get(
  "/messages",
  widgetAuth,
  asyncHandler(async (req, res) => {
    const items = await pollMessages(req.widget.sessionId, req.query.since?.toString());
    res.json({ items });
  }),
);
