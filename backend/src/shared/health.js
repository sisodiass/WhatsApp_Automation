import { prisma, pingDb } from "./prisma.js";
import { pingRedis } from "./redis.js";

async function safe(fn) {
  try {
    await fn();
    return "ok";
  } catch (err) {
    return { status: "error", message: err.message };
  }
}

async function checkVectorExtension() {
  // Confirms pgvector is installed. The extension is created by the init
  // migration; this guards against a Postgres image that lost it.
  const rows = await prisma.$queryRaw`SELECT extversion FROM pg_extension WHERE extname='vector'`;
  if (!rows.length) throw new Error("pgvector extension not installed");
}

export async function getHealth() {
  const [db, redis, vector] = await Promise.all([
    safe(pingDb),
    safe(pingRedis),
    safe(checkVectorExtension),
  ]);

  const overall = [db, redis, vector].every((s) => s === "ok") ? "ok" : "degraded";
  return { status: overall, api: "ok", db, redis, vector };
}
