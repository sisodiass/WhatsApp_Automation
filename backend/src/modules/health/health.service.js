// Comprehensive traffic-light health check used by the admin dashboard.
// Each check returns { name, status: "ok" | "yellow" | "red", ...meta }.
// Overall status = worst component status.

import { prisma } from "../../shared/prisma.js";
import { redis } from "../../shared/redis.js";
import { getQueue, QUEUES } from "../../shared/queue.js";
import { getLastStatus } from "../whatsapp/whatsapp.bus.js";
import { getLiveness } from "../whatsapp/whatsapp.consumer.js";

const FAILED_QUEUE_THRESHOLD = 50; // > this many failed jobs flips the queue to yellow

async function checkApi() {
  return { name: "api", status: "ok" };
}

async function checkPostgres() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { name: "postgres", status: "ok" };
  } catch (err) {
    return { name: "postgres", status: "red", error: err.message };
  }
}

async function checkRedis() {
  try {
    const r = await redis.ping();
    if (r !== "PONG") throw new Error(`unexpected ping: ${r}`);
    return { name: "redis", status: "ok" };
  } catch (err) {
    return { name: "redis", status: "red", error: err.message };
  }
}

async function checkPgvector() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT extversion FROM pg_extension WHERE extname='vector'`;
    if (!rows.length) {
      return { name: "pgvector", status: "red", error: "extension not installed" };
    }
    return { name: "pgvector", status: "ok", version: rows[0].extversion };
  } catch (err) {
    return { name: "pgvector", status: "red", error: err.message };
  }
}

async function checkWaWorker() {
  const live = getLiveness();
  if (!live.alive) {
    return {
      name: "wa-worker",
      status: "red",
      error: "no heartbeat",
      ageMs: live.ageMs,
    };
  }
  return { name: "wa-worker", status: "ok", state: live.state, ageMs: live.ageMs };
}

const WA_STATUS_MAP = {
  READY: "ok",
  AUTHENTICATING: "yellow",
  AWAITING_QR: "yellow",
  BOOTING: "yellow",
  DISCONNECTED: "red",
  AUTH_FAILURE: "red",
};

async function checkWhatsappStatus() {
  const status = await getLastStatus();
  const result = {
    name: "whatsapp",
    status: WA_STATUS_MAP[status.state] || "red",
    state: status.state,
    at: status.at,
  };
  if (status.info) result.info = String(status.info);
  return result;
}

async function checkQueue(queueName) {
  try {
    const q = getQueue(queueName);
    const counts = await q.getJobCounts("waiting", "active", "delayed", "failed");
    let status = "ok";
    if (counts.failed > FAILED_QUEUE_THRESHOLD) status = "yellow";
    return { name: `queue:${queueName}`, status, counts };
  } catch (err) {
    return { name: `queue:${queueName}`, status: "red", error: err.message };
  }
}

const RANK = { ok: 0, yellow: 1, red: 2 };
function worstStatus(components) {
  let worst = "ok";
  for (const c of components) {
    if (RANK[c.status] > RANK[worst]) worst = c.status;
  }
  return worst;
}

export async function getFullHealth() {
  const components = await Promise.all([
    checkApi(),
    checkPostgres(),
    checkRedis(),
    checkPgvector(),
    checkWaWorker(),
    checkWhatsappStatus(),
    ...Object.values(QUEUES).map((q) => checkQueue(q)),
  ]);
  return {
    status: worstStatus(components),
    at: new Date().toISOString(),
    components,
  };
}
