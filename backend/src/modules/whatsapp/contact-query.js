// Request/response helper for asking the wa-worker about a contact by
// JID. The API never imports whatsapp-web.js — all calls go through
// the redis bus. The worker handler lives in workers/whatsapp.worker.js.
//
// Used by the LID-backfill admin endpoint: walk existing @lid contacts
// and ask the worker for their current number + pushname. The contact
// row's mobile + firstName/lastName + notifyName are then updated with
// whatever the worker found.

import crypto from "node:crypto";
import { Channels, publish, subscribe } from "./whatsapp.bus.js";
import { child } from "../../shared/logger.js";

const log = child("wa-contact-query");

// Single shared subscriber. Multiple in-flight queries multiplex on
// requestId. We keep this lazy so the API process doesn't open a
// subscriber connection unless the feature is actually used.
let sub = null;
const inflight = new Map(); // requestId -> { resolve, reject, timeout }

function ensureSubscriber() {
  if (sub) return;
  sub = subscribe([Channels.CONTACT_QUERY_RESPONSE], (channel, payload) => {
    if (channel !== Channels.CONTACT_QUERY_RESPONSE) return;
    const { requestId } = payload || {};
    if (!requestId) return;
    const pending = inflight.get(requestId);
    if (!pending) return; // late response, no-op
    clearTimeout(pending.timeout);
    inflight.delete(requestId);
    pending.resolve(payload);
  });
  log.info("contact-query subscriber wired");
}

/**
 * Ask the wa-worker for contact info by JID. Returns
 *   { ok: true, number, pushname }   on success (some fields may be null)
 *   { ok: false, error }              on worker error or timeout
 *
 * Times out at `timeoutMs` (default 5000ms). Safe to call concurrently —
 * each request is keyed by a unique id.
 */
export async function queryContact(jid, timeoutMs = 5000) {
  if (!jid) return { ok: false, error: "no jid" };
  ensureSubscriber();
  const requestId = crypto.randomBytes(8).toString("hex");
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      inflight.delete(requestId);
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);
    inflight.set(requestId, { resolve, reject: () => {}, timeout });
    publish(Channels.CONTACT_QUERY, { requestId, jid }).catch((err) => {
      clearTimeout(timeout);
      inflight.delete(requestId);
      resolve({ ok: false, error: `publish failed: ${err.message}` });
    });
  });
}
