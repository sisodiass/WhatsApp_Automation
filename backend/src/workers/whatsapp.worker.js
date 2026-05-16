// wa-worker: owns the whatsapp-web.js Client (Chromium via Puppeteer) and
// LocalAuth session. Speaks to the API over Redis pub/sub only.
//
// Run: `npm run start:wa` (production via PM2) or `npm run dev:wa`.

import path from "node:path";
import { fileURLToPath } from "node:url";
import wajs from "whatsapp-web.js";

import { config } from "../config/index.js";
import { child } from "../shared/logger.js";
import { redis } from "../shared/redis.js";
import {
  Channels,
  Status,
  publish,
  subscribe,
  setLastQr,
  setLastStatus,
} from "../modules/whatsapp/whatsapp.bus.js";

const { Client, LocalAuth } = wajs;
const log = child("wa-worker");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// LocalAuth folder — survives restarts so QR scanning is one-time.
// Lives at backend/.wwebjs_auth (gitignored).
const AUTH_DATA_PATH = path.resolve(__dirname, "../../.wwebjs_auth");

const startedAt = Date.now();
let lastState = Status.BOOTING;

async function setStatus(state, info) {
  lastState = state;
  const payload = { state, info, at: new Date().toISOString() };
  await setLastStatus(payload);
  await publish(Channels.STATUS, payload);
  log.info("status", payload);
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: AUTH_DATA_PATH }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  },
});

// ─── Client events ────────────────────────────────────────────────────

client.on("qr", async (qr) => {
  // Fired repeatedly until scanned (every ~20s a fresh code arrives).
  const expiresAt = new Date(Date.now() + 20_000).toISOString();
  await setLastQr({ qr, expiresAt });
  await publish(Channels.QR, { qr, expiresAt });
  await setStatus(Status.AWAITING_QR);
});

client.on("authenticated", () => setStatus(Status.AUTHENTICATING));
client.on("auth_failure", (msg) => setStatus(Status.AUTH_FAILURE, msg));
client.on("ready", async () => {
  // Cache the connected number so the API can hand it to the UI for
  // building wa.me links per campaign tag.
  const me = client.info?.wid?.user || null;
  if (me) {
    await redis.set("wa:me", me).catch(() => {});
    log.info("connected number cached", { me });
  }
  await setStatus(Status.READY);
});
client.on("disconnected", (reason) => setStatus(Status.DISCONNECTED, reason));
client.on("change_state", (s) => log.debug("change_state", { s }));

client.on("message", async (msg) => {
  // Inbound customer message. Dedup downstream by msg.id._serialized.
  if (msg.fromMe) return;
  // WhatsApp Status updates arrive as msg events with from="status@broadcast".
  // We never want to treat those as customer inbound — drop here.
  if (msg.from === "status@broadcast" || msg.from?.endsWith("@broadcast")) return;
  // Newsletter / channel messages have @newsletter suffix — same treatment.
  if (msg.from?.endsWith("@newsletter")) return;

  // When the JID is an @lid (WhatsApp's privacy-first identifier) we
  // attempt to resolve the underlying real phone via getContact(). For
  // some LID contacts WhatsApp doesn't surface a real phone — in that
  // case we leave contactPhone null and the consumer falls back to the
  // JID so the unique-on-mobile constraint still holds.
  let contactPhone = null;
  if (msg.from?.endsWith("@lid")) {
    try {
      const contact = await msg.getContact();
      const resolved = contact?.number;
      // Sanity: must be all digits, reasonable phone length, and NOT
      // equal to the LID's user part (avoids false-positives where
      // .number is the LID itself).
      if (
        resolved &&
        /^\d{7,15}$/.test(String(resolved)) &&
        !msg.from.startsWith(`${resolved}@`)
      ) {
        contactPhone = String(resolved);
      }
    } catch (err) {
      log.debug("getContact failed for LID sender", { from: msg.from, err: err.message });
    }
  }

  const payload = {
    waMessageId: msg.id?._serialized,
    from: msg.from, // routing JID; may be "919999999999@c.us" or "...@lid"
    contactPhone, // resolved real phone for CRM display; null if LID-only
    body: msg.body || "",
    notifyName: msg._data?.notifyName || null,
    at: new Date(msg.timestamp ? msg.timestamp * 1000 : Date.now()).toISOString(),
    type: msg.type, // "chat", "image", etc.
    hasMedia: msg.hasMedia,
  };
  await publish(Channels.INBOUND, payload);
});

// ─── Outbound + control subscriber ───────────────────────────────────

subscribe([Channels.OUTBOUND, Channels.CONTROL, Channels.CONTACT_QUERY], async (channel, payload) => {
  if (channel === Channels.CONTACT_QUERY) {
    const { requestId, jid } = payload || {};
    if (!requestId || !jid) return;
    if (lastState !== Status.READY) {
      await publish(Channels.CONTACT_QUERY_RESPONSE, {
        requestId,
        ok: false,
        error: `wa not ready (${lastState})`,
      });
      return;
    }
    try {
      const contact = await client.getContactById(jid);
      const number = contact?.number || null;
      const pushname = contact?.pushname || null;
      await publish(Channels.CONTACT_QUERY_RESPONSE, {
        requestId,
        ok: true,
        number,
        pushname,
      });
    } catch (err) {
      await publish(Channels.CONTACT_QUERY_RESPONSE, {
        requestId,
        ok: false,
        error: err.message,
      });
    }
    return;
  }
  if (channel === Channels.OUTBOUND) {
    const { messageId, to, body, simulateTyping } = payload || {};
    if (!to || !body) {
      log.warn("outbound missing fields", { messageId });
      await publish(Channels.OUTBOUND_ACK, { messageId, ok: false, error: "missing fields" });
      return;
    }
    if (lastState !== Status.READY) {
      log.warn("outbound while not READY", { messageId, lastState });
      await publish(Channels.OUTBOUND_ACK, {
        messageId,
        ok: false,
        error: `not ready (${lastState})`,
      });
      return;
    }

    try {
      if (simulateTyping && simulateTyping > 0) {
        const chat = await client.getChatById(to);
        await chat.sendStateTyping();
        await new Promise((r) => setTimeout(r, simulateTyping));
        await chat.clearState();
      }
      const sent = await client.sendMessage(to, body);
      await publish(Channels.OUTBOUND_ACK, {
        messageId,
        ok: true,
        waMessageId: sent.id?._serialized,
      });
    } catch (err) {
      log.error("send failed", { messageId, err: err.message });
      await publish(Channels.OUTBOUND_ACK, { messageId, ok: false, error: err.message });
    }
    return;
  }

  if (channel === Channels.CONTROL) {
    const action = payload?.action;
    log.info("control", { action });
    if (action === "logout") {
      try {
        await client.logout();
      } catch (err) {
        log.error("logout error", { err: err.message });
      }
    } else if (action === "restart") {
      // Easiest path: exit; PM2 restarts us. In dev this just exits.
      process.exit(0);
    }
  }
});

// ─── Heartbeat ────────────────────────────────────────────────────────

const HEARTBEAT_MS = 15_000;
const heartbeat = setInterval(async () => {
  await publish(Channels.HEARTBEAT, {
    at: new Date().toISOString(),
    state: lastState,
    uptimeMs: Date.now() - startedAt,
  });
}, HEARTBEAT_MS);

// ─── Boot ─────────────────────────────────────────────────────────────

async function main() {
  log.info("starting", { auth: AUTH_DATA_PATH, env: config.env });
  await setStatus(Status.BOOTING);
  await client.initialize();
}

function shutdown(signal) {
  log.info(`received ${signal}, shutting down`);
  clearInterval(heartbeat);
  client
    .destroy()
    .catch(() => {})
    .finally(() => {
      redis.quit().finally(() => process.exit(0));
    });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  log.error("uncaughtException", { err: err.message, stack: err.stack });
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (err) => {
  log.error("unhandledRejection", { err: err?.message || String(err) });
});

main().catch((err) => {
  log.error("fatal init", { err: err.message, stack: err.stack });
  process.exit(1);
});
