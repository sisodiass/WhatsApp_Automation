// In-process domain event bus.
//
// Used by services to emit "something meaningful happened" notifications
// that other modules can subscribe to without creating direct service-
// to-service dependencies. M2 emits lead.stage.changed; M6 (workflow
// automation) will subscribe and use this as one of its trigger sources.
//
// Synchronous and best-effort: a listener throwing should never break the
// emitter. Crashes are logged but swallowed.
//
// This is NOT for cross-process events (use Redis pub/sub for that — see
// whatsapp.bus.js). Workflows that need to survive a process restart must
// persist their own state and not rely on this bus.

import { EventEmitter } from "node:events";
import { child } from "./logger.js";

const log = child("events");

const bus = new EventEmitter();
// Listeners are wrapped on subscribe so a throw never bubbles to the emitter.
const safeListeners = new WeakMap();

export const Events = Object.freeze({
  // Lead lifecycle — payload: { leadId, tenantId, fromStageId?, toStageId, actorId? }
  LEAD_STAGE_CHANGED: "lead.stage.changed",
  // Lead created — payload: { leadId, tenantId, contactId, assignedToId?, actorId? }
  LEAD_CREATED: "lead.created",
  // Lead assignment changed — payload: { leadId, tenantId, fromUserId?, toUserId?, actorId? }
  LEAD_ASSIGNED: "lead.assigned",
  // M5: a follow-up rule fired against a lead — payload:
  // { leadId, tenantId, ruleId, messageId }. M7 workflow automation
  // subscribes here.
  LEAD_FOLLOWUP_SENT: "lead.followup.sent",
  // M11 revenue events. Automation subscriber maps these to the
  // QUOTATION_ACCEPTED / PAYMENT_RECEIVED triggers.
  QUOTATION_ACCEPTED: "quotation.accepted",
  PAYMENT_RECEIVED: "payment.received",
});

export function on(event, listener) {
  const safe = (payload) => {
    try {
      const r = listener(payload);
      if (r && typeof r.catch === "function") {
        r.catch((err) =>
          log.error("event listener (async) threw", {
            event,
            err: err.message,
            stack: err.stack,
          }),
        );
      }
    } catch (err) {
      log.error("event listener threw", { event, err: err.message });
    }
  };
  safeListeners.set(listener, safe);
  bus.on(event, safe);
  return () => off(event, listener);
}

export function off(event, listener) {
  const safe = safeListeners.get(listener);
  if (safe) bus.off(event, safe);
}

export function emit(event, payload) {
  log.debug("emit", { event, payload });
  bus.emit(event, payload);
}
