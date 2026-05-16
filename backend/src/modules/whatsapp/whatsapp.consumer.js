// Bridges wa-worker's Redis pub/sub stream into Socket.io for the admin UI,
// routes inbound messages into the session engine, and closes the outbound
// dedup loop by writing messages.sent_at on ack.
//
// Lives in the API process — never imports whatsapp-web.js.

import { child } from "../../shared/logger.js";
import { emitToAdmins } from "../../shared/socket.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import { handleInbound, markOutboundSent } from "../sessions/session.service.js";
import {
  Channels,
  Status,
  publish,
  subscribe,
  setLastStatus,
} from "./whatsapp.bus.js";

const log = child("wa-consumer");

let lastHeartbeatAt = null;
let lastHeartbeatState = null;

export function getLiveness() {
  if (!lastHeartbeatAt) return { alive: false, ageMs: null, state: null };
  const ageMs = Date.now() - lastHeartbeatAt;
  return { alive: ageMs < 35_000, ageMs, state: lastHeartbeatState };
}

export function startWhatsappConsumer() {
  subscribe(
    [
      Channels.QR,
      Channels.STATUS,
      Channels.INBOUND,
      Channels.HEARTBEAT,
      Channels.OUTBOUND_ACK,
    ],
    async (channel, payload) => {
      try {
        switch (channel) {
          case Channels.QR:
            emitToAdmins("wa:qr", payload);
            log.debug("qr broadcast");
            break;

          case Channels.STATUS:
            emitToAdmins("wa:status", payload);
            log.info("status", payload);
            break;

          case Channels.HEARTBEAT:
            lastHeartbeatAt = Date.now();
            lastHeartbeatState = payload.state;
            break;

          case Channels.INBOUND: {
            const tenantId = await getDefaultTenantId();
            const result = await handleInbound({
              tenantId,
              from: payload.from,
              // M11.fix: real phone resolved by the worker when the
              // sender used an @lid identifier. null when WhatsApp
              // didn't expose one — handleInbound falls back to the JID.
              contactPhone: payload.contactPhone || null,
              body: payload.body,
              waMessageId: payload.waMessageId,
              displayName: payload.notifyName,
            });
            // Live preview for admin UI — Phase 5 will replace this with
            // a richer "message added to session" event after AI replies.
            emitToAdmins("wa:inbound_preview", {
              ...payload,
              result,
            });
            break;
          }

          case Channels.OUTBOUND_ACK:
            await markOutboundSent(payload);
            break;
        }
      } catch (err) {
        log.error("consumer handler error", {
          channel,
          err: err.message,
          stack: err.stack,
        });
      }
    },
  );

  // If wa-worker isn't running on API boot, surface DISCONNECTED so /status
  // doesn't return a stale "READY" from the previous deploy.
  setLastStatus({ state: Status.DISCONNECTED, at: new Date().toISOString() }).catch((err) =>
    log.error("setLastStatus on boot", { err: err.message }),
  );

  log.info("subscribed", { channels: 5 });
}

// Helpers used by REST controller.
export function requestLogout() {
  return publish(Channels.CONTROL, { action: "logout" });
}

export function requestRestart() {
  return publish(Channels.CONTROL, { action: "restart" });
}
