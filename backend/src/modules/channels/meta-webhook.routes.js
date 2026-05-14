// Public webhooks: /api/webhooks/meta/instagram, /api/webhooks/meta/messenger.
//
// GET  is the one-time verification challenge Meta runs when an operator
//      configures the webhook URL in their developer dashboard. We echo
//      the hub.challenge if hub.verify_token matches our stored token.
// POST is the actual webhook delivery. We re-read the raw body to verify
//      X-Hub-Signature-256, then hand off to handleMetaWebhook.

import { Router } from "express";
import { asyncHandler, BadRequest, Unauthorized } from "../../shared/errors.js";
import { child } from "../../shared/logger.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import { getChannelByType } from "./channel.service.js";
import { handleMetaWebhook, verifyMetaSignature } from "./meta-webhook.service.js";

const log = child("meta-routes");

// Map URL slug → ChannelType enum.
const SLUG_TO_TYPE = {
  instagram: "INSTAGRAM",
  messenger: "FB_MESSENGER",
};
// `req.rawBody` is populated by the global express.json() verify hook in
// src/index.js — installed only for /api/webhooks/meta/* paths.

export const metaWebhookRouter = Router();

// One-time verification challenge.
metaWebhookRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const type = SLUG_TO_TYPE[String(req.params.slug).toLowerCase()];
    if (!type) throw BadRequest("unknown meta channel slug");
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode !== "subscribe" || typeof challenge !== "string") {
      throw BadRequest("invalid challenge");
    }
    const tenantId = await getDefaultTenantId();
    const channel = await getChannelByType(tenantId, type);
    if (!channel?.isActive) throw Unauthorized("channel not configured / inactive");
    const expected = channel.config?.verifyToken;
    if (!expected || token !== expected) throw Unauthorized("verify_token mismatch");
    res.type("text/plain").send(challenge);
  }),
);

// Webhook delivery.
metaWebhookRouter.post(
  "/:slug",
  asyncHandler(async (req, res) => {
    const type = SLUG_TO_TYPE[String(req.params.slug).toLowerCase()];
    if (!type) throw BadRequest("unknown meta channel slug");
    const tenantId = await getDefaultTenantId();
    const channel = await getChannelByType(tenantId, type);
    if (!channel?.isActive) {
      // Always 200 on inactive — Meta retries aggressively on errors and
      // we don't want them spinning on a deliberately-off channel.
      log.warn("meta webhook for inactive channel", { type });
      return res.status(200).json({ skipped: "inactive" });
    }
    const appSecret = channel.config?.appSecret;
    const sig = req.headers["x-hub-signature-256"];
    if (!appSecret || !verifyMetaSignature(req.rawBody, sig, appSecret)) {
      throw Unauthorized("bad signature");
    }
    const summary = await handleMetaWebhook(channel, req.body);
    res.json(summary);
  }),
);
