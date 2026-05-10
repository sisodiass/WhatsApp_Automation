import IORedis from "ioredis";
import { config } from "../config/index.js";
import { child } from "./logger.js";

const log = child("redis");

// Single shared client for normal commands. Pub/sub subscribers must use
// dedicated connections (Redis blocks the connection in subscribe mode).
export const redis = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null, // BullMQ requirement
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on("error", (err) => log.error("redis error", { err: err.message }));
redis.on("ready", () => log.info("redis ready"));

export function createSubscriber() {
  return new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
}

export async function pingRedis() {
  const r = await redis.ping();
  if (r !== "PONG") throw new Error(`unexpected redis ping: ${r}`);
}
