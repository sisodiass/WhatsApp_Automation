// Redis pub/sub contract between the API process and the wa-worker process.
// The API NEVER imports whatsapp-web.js — all interaction goes through here.

import { redis, createSubscriber } from "../../shared/redis.js";

export const Channels = {
  // wa-worker → API
  QR: "wa:qr",                 // payload: { qr: string, expiresAt: ISO }
  STATUS: "wa:status",         // payload: { state, info?, at: ISO }
  INBOUND: "wa:inbound",       // payload: { waMessageId, from, body, at: ISO, ack }
  HEARTBEAT: "wa:heartbeat",   // payload: { at: ISO, state, uptimeMs }
  OUTBOUND_ACK: "wa:outbound_ack", // payload: { messageId, ok, error? }

  // API → wa-worker
  OUTBOUND: "wa:outbound",     // payload: { messageId, to, body, simulateTyping?: ms }
  CONTROL: "wa:control",       // payload: { action: "logout" | "restart" }
};

// Status states emitted by wa-worker. Keep in sync with whatsapp.worker.js.
export const Status = {
  BOOTING: "BOOTING",
  AWAITING_QR: "AWAITING_QR",
  AUTHENTICATING: "AUTHENTICATING",
  READY: "READY",
  DISCONNECTED: "DISCONNECTED",
  AUTH_FAILURE: "AUTH_FAILURE",
};

// Cached "last status" key — REST GET /status reads this without depending on
// whether anyone is currently subscribed to the live pub/sub.
const LAST_STATUS_KEY = "wa:last_status";
const LAST_QR_KEY = "wa:last_qr";
// Connected number (set by wa-worker on the "ready" event). Used by the
// admin UI to build wa.me links per campaign tag.
const ME_KEY = "wa:me";

export async function publish(channel, payload) {
  await redis.publish(channel, JSON.stringify(payload));
}

export function subscribe(channels, handler) {
  const sub = createSubscriber();
  sub.subscribe(...channels, (err, count) => {
    if (err) throw err;
    if (count !== channels.length) {
      // ioredis returns total active subs across this connection; harmless.
    }
  });
  sub.on("message", (channel, raw) => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { raw };
    }
    handler(channel, payload);
  });
  return sub;
}

export async function setLastStatus(status) {
  await redis.set(LAST_STATUS_KEY, JSON.stringify(status));
}

export async function getLastStatus() {
  const raw = await redis.get(LAST_STATUS_KEY);
  return raw ? JSON.parse(raw) : { state: Status.DISCONNECTED, at: null };
}

export async function setLastQr(qr) {
  // Short TTL — QRs expire ~20s in WA; we keep last for 60s as a safety net.
  await redis.set(LAST_QR_KEY, JSON.stringify(qr), "EX", 60);
}

export async function getLastQr() {
  const raw = await redis.get(LAST_QR_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function getConnectedNumber() {
  return redis.get(ME_KEY);
}
