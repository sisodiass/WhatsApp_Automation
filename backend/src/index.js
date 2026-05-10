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
app.use(express.json({ limit: "1mb" }));
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
