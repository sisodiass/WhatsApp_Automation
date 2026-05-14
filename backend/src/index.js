import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { config } from "./config/index.js";
import { logger, child } from "./shared/logger.js";
import { initSocket } from "./shared/socket.js";
import { errorMiddleware } from "./shared/errors.js";
import { getHealth } from "./shared/health.js";
import { ensureKbIndexes } from "./shared/db-init.js";
import {
  authLimiter,
  compress,
  generalLimiter,
  requestId,
  securityHeaders,
  sensitiveLimiter,
} from "./shared/hardening.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { whatsappRouter } from "./modules/whatsapp/whatsapp.routes.js";
import { startWhatsappConsumer } from "./modules/whatsapp/whatsapp.consumer.js";
import { campaignRouter } from "./modules/campaigns/campaign.routes.js";
import { sessionRouter } from "./modules/sessions/session.routes.js";
import { kbRouter } from "./modules/kb/kb.routes.js";
import { aiRouter } from "./modules/ai/ai.routes.js";
import { agentRouter } from "./modules/sessions/agent.routes.js";
import { tagRouter, chatTagRouter } from "./modules/tags/tag.routes.js";
import { noteRouter } from "./modules/notes/note.routes.js";
import { templateRouter } from "./modules/templates/template.routes.js";
import { settingsRouter } from "./modules/settings/settings.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { analyticsRouter } from "./modules/analytics/analytics.routes.js";
import { demoRouter } from "./modules/teams/demo.routes.js";
import { contactRouter } from "./modules/contacts/contact.routes.js";
import { pipelineRouter } from "./modules/pipelines/pipeline.routes.js";
import { leadRouter } from "./modules/leads/lead.routes.js";
import { taskRouter } from "./modules/tasks/task.routes.js";
import { bulkCampaignRouter } from "./modules/bulk-campaigns/bulk-campaign.routes.js";
import { followupRouter } from "./modules/followups/followup.routes.js";
import { automationRouter } from "./modules/automations/automation.routes.js";
import { startAutomationSubscribers } from "./modules/automations/automation.subscriber.js";
import { aiScoringRouter } from "./modules/ai/scoring.routes.js";
import { notificationRouter } from "./modules/notifications/notification.routes.js";
import { startNotificationSubscribers } from "./modules/notifications/notification.subscriber.js";
import { widgetRouter } from "./modules/widget/widget.routes.js";
import { channelRouter } from "./modules/channels/channel.routes.js";
import { metaWebhookRouter } from "./modules/channels/meta-webhook.routes.js";
import { integrationRouter } from "./modules/integrations/integration.routes.js";
import { publicRouter } from "./modules/public/public.routes.js";
import { mountBullBoard } from "./modules/admin/queues.routes.js";

const log = child("api");

const app = express();
// Trust the first proxy hop — Cloudflare / Nginx / Caddy. MUST be set before
// rate limiters so they see the real client IP from X-Forwarded-For.
app.set("trust proxy", 1);

// Hardening middleware (order matters).
app.use(requestId);
app.use(securityHeaders());
app.use(compress());
// M10: capture raw body for Meta webhook signature verification. The
// `verify` callback runs synchronously during JSON parsing and is the
// only safe place to grab the unparsed bytes — by the time route
// handlers run the stream is consumed.
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buf) => {
    if (req.originalUrl?.startsWith("/api/webhooks/meta/")) {
      req.rawBody = buf;
    }
  },
}));
app.use(cookieParser());
app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  }),
);
app.use(generalLimiter);

// ─── Routes ──────────────────────────────────────────────────────────

// Public health check — used by load balancers / Cloudflare. Cheap and unauth.
app.get("/health", async (_req, res) => {
  const h = await getHealth();
  res.status(h.status === "ok" ? 200 : 503).json(h);
});

// Auth flows get a stricter limiter to blunt credential stuffing.
app.use("/api/auth", authLimiter, authRouter);

app.use("/api/whatsapp", whatsappRouter);
app.use("/api/campaigns", campaignRouter);
app.use("/api/kb", kbRouter);
app.use("/api/ai", sensitiveLimiter, aiRouter); // /ai/health round-trips to OpenAI/Gemini
app.use("/api/tags", tagRouter);
app.use("/api/templates", templateRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/health", healthRouter);
app.use("/api/analytics", analyticsRouter);
// CRM (M1)
app.use("/api/contacts", contactRouter);
app.use("/api/pipelines", pipelineRouter);
app.use("/api/leads", leadRouter);
app.use("/api/tasks", taskRouter);
// Bulk broadcasts (M4)
app.use("/api/bulk-campaigns", bulkCampaignRouter);
// Follow-up engine (M5)
app.use("/api/followups", followupRouter);
// Workflow automation (M6)
app.use("/api/automations", automationRouter);
// In-app notifications (M8). Polling-based — no Socket.io per scope rule.
app.use("/api/notifications", notificationRouter);
// Web-chat widget public API (M9). Mounted BEFORE the catch-all /api
// routers below — they call requireAuth at the router level which would
// otherwise intercept the anonymous /start call. Permissive CORS because
// the widget loads from arbitrary customer landing pages.
app.use("/api/widget/v1", cors({ origin: true, credentials: false }), widgetRouter);
// Serve the widget embed page + loader statically. Bundled with the
// backend so operators can iframe-embed or <script>-include without
// standing up a separate server.
app.use("/widget", express.static(path.resolve(process.cwd(), "public/widget")));
// Convenience: /widget.js → public/widget/widget.js so the embed
// snippet stays short:  <script src="https://crm.example.com/widget.js">
app.get("/widget.js", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.sendFile(path.resolve(process.cwd(), "public/widget/widget.js"));
});
// M10: Meta webhooks. Mounted BEFORE the catch-all auth router because
// these are PUBLIC endpoints validated by the X-Hub-Signature-256 header,
// not by an agent JWT. Cross-origin: Meta posts from its own servers.
app.use("/api/webhooks/meta", cors({ origin: true, credentials: false }), metaWebhookRouter);
// M10: Channel admin endpoints. Auth-gated; SUPER_ADMIN/ADMIN write.
app.use("/api/channels", channelRouter);
// Website-integration admin endpoints (admin-only, JWT-gated). Hosts
// the CRUD for API keys + widget config used by /public/*.
app.use("/api/integrations", integrationRouter);
// Public API surface — API-key gated, permissive CORS so any allowed
// origin can call it from a browser. Mounted BEFORE the catch-all /api
// router so the public router gets first crack at /public/* paths and
// CORS preflight (OPTIONS) headers aren't shadowed by other middleware.
app.use(
  "/public",
  cors({ origin: true, credentials: false }),
  publicRouter,
);
// AI lead scoring + suggested replies (M7). Sensitive limiter applies
// because every call round-trips to the configured AI provider. This is
// a catch-all mount on /api so it must sit BELOW the explicit prefixes.
app.use("/api", sensitiveLimiter, aiScoringRouter);
app.use("/api", sensitiveLimiter, demoRouter); // demo booking hits Graph API
app.use("/api", chatTagRouter);
app.use("/api", noteRouter);
app.use("/api", agentRouter);
app.use("/api", sessionRouter);

mountBullBoard(app);

// 404 + error handlers (must be last)
app.use((req, res) => res.status(404).json({ error: { code: "not_found", message: "Not found" } }));
app.use(errorMiddleware);

// ─── Boot ────────────────────────────────────────────────────────────

// Ensure local upload directory exists before multer tries to write to it.
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const server = http.createServer(app);
initSocket(server);
startWhatsappConsumer();
// M6: register in-process automation triggers. LEAD_* events originate
// here (lead.service); the worker process registers its own subscribers
// for events that originate there (LEAD_FOLLOWUP_SENT). Either path
// enqueues to the shared automation-runs queue.
startAutomationSubscribers();
// M8: bell-icon notifications. Same multi-process subscriber pattern.
startNotificationSubscribers();

// Apply pgvector + tsvector indexes (idempotent).
ensureKbIndexes().catch((err) => log.error("ensureKbIndexes failed", { err: err.message }));

server.listen(config.port, () => {
  log.info(`API listening on :${config.port} (${config.env})`);
});

function shutdown(signal) {
  log.info(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (err) => logger.error("unhandledRejection", { err }));
process.on("uncaughtException", (err) => logger.error("uncaughtException", { err: err.message }));
