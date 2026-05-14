// outgoing-messages worker — last-mile sender. Re-checks session state
// just before publishing to wa:outbound (A2 manual override priority),
// applies the warmup-aware delay (A1), and lets BullMQ enforce the
// per-minute rate limit set on the Worker (R8).
//
// Outbound dedup (A3): jobId="out-<messageId>" upstream + the messages.sent_at
// IS NULL guard here. Either alone is sufficient; together they're robust.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { getSettings } from "../../modules/settings/settings.service.js";
import { dispatchOutbound } from "../../modules/channels/outbound-dispatcher.js";

const log = child("q:outgoing");

export async function processOutgoingJob(job) {
  const { messageId, delayMs } = job.data;

  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    include: { session: { include: { chat: { include: { channel: true } } } } },
  });
  if (!msg) return { skipped: "missing" };
  if (msg.sentAt) return { skipped: "already_sent" };
  if (msg.direction !== "OUT") return { skipped: "not_outbound" };

  // A2: re-check session state for AI replies. SYSTEM messages are sent
  // unconditionally — they're either onboarding/resume (always wanted) or
  // the handoff notice (which itself flipped the mode).
  if (msg.source === "AI") {
    if (msg.session.endedAt) {
      log.info("session ended; skipping AI send", { messageId });
      return { skipped: "session_ended" };
    }
    if (msg.session.mode !== "AI") {
      log.info("session no longer AI mode; skipping send (manual override)", {
        messageId,
        mode: msg.session.mode,
      });
      return { skipped: "manual_override" };
    }
  }

  const tenantId = msg.session.chat.tenantId;
  const cfg = await getSettings(tenantId, [
    "wa.delay_min_seconds",
    "wa.delay_max_seconds",
    "wa.warmup_mode",
    "wa.warmup_delay_min_seconds",
    "wa.warmup_delay_max_seconds",
  ]);

  // A1: warmup mode → larger random delays.
  const warmup = cfg["wa.warmup_mode"] === true;
  const min = Number(
    warmup ? cfg["wa.warmup_delay_min_seconds"] ?? 15 : cfg["wa.delay_min_seconds"] ?? 8,
  );
  const max = Number(
    warmup ? cfg["wa.warmup_delay_max_seconds"] ?? 40 : cfg["wa.delay_max_seconds"] ?? 25,
  );

  // AI and SYSTEM (onboarding, fallback, handoff templates) both get the
  // randomized delay + typing simulation so the conversation feels human.
  // AGENT replies are sent instantly — a human just typed them in the UI
  // and adding more wait would frustrate the operator.
  // Producer can override with an explicit delayMs (use 0 for instant).
  let typingMs;
  if (delayMs !== null && delayMs !== undefined) {
    typingMs = Math.max(0, Number(delayMs));
  } else if (msg.source === "AI" || msg.source === "SYSTEM") {
    const span = Math.max(0, max - min);
    typingMs = (min + Math.random() * span) * 1000;
  } else {
    typingMs = 0;
  }

  // M10: per-channel dispatch. WhatsApp keeps the redis pub/sub round-
  // trip (ack drives sent_at later); Meta channels POST directly to
  // Graph API and stamp sent_at inline; Web Chat sets sent_at locally
  // because the widget already polls the DB.
  const chat = msg.session.chat;
  const result = await dispatchOutbound({
    msg,
    chat,
    channel: chat.channel,
    typingMs: Math.round(typingMs),
  });

  log.info("dispatched", {
    messageId,
    source: msg.source,
    channel: chat.channel?.type || "WHATSAPP",
    typingMs: Math.round(typingMs),
    warmup,
    result,
  });
  return result;
}
