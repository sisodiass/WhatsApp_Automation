// incoming-messages worker — runs the gates that decide whether the
// inbound customer message triggers an AI reply. Cheap DB reads only;
// heavy lifting is delegated to kb-search.
//
// Gates (in order):
//   1. Message + session exist, session not ended.
//   2. session.mode === AI (otherwise it's already MANUAL — agent owns it)
//   3. ai_reply_count < ai.max_replies_per_session  (auto-MANUAL trigger)
//   4. M11.B3 keyword-driven handover (human request, opt-in negative
//      sentiment) — hard auto-MANUAL flip on match. Default ON for
//      human-request, OFF for sentiment.
//   5. settings.ai.global_enabled                   (FALLBACK — keeps mode AI)
//   6. campaign has at least one KB group attached  (FALLBACK — keeps mode AI)
//
// Policy: the cap (gate 3) is the only auto-flip in the original design.
// M11.B3 adds two more explicit auto-flips because they are unambiguous
// customer signals: "I want a human" (gate 4a) and frustration cues
// (gate 4b, opt-in). Everything else (global off, no KB groups, low
// confidence in kb-search, generation timeout) sends the FALLBACK
// template, counts toward the cap, and stays in AI mode.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { emitChatMessage } from "../../shared/socket.js";
import { getSettings } from "../../modules/settings/settings.service.js";
import {
  flipSessionToManual,
  pushToManualQueue,
} from "../../modules/sessions/manual-queue.service.js";
import { renderTemplate } from "../../modules/templates/template.service.js";
import { sendFallbackMessage } from "../../modules/ai/fallback.service.js";
import { enqueueKbSearch, enqueueOutbound } from "../../modules/queue/producers.js";
import { evaluateHandover } from "../../modules/ai/handover-detector.js";

const log = child("q:incoming");

export async function processIncomingJob(job) {
  const { messageId } = job.data;

  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      session: {
        include: { chat: true, campaign: { include: { kbGroups: true } } },
      },
    },
  });
  if (!msg) {
    log.warn("message vanished", { messageId });
    return { skipped: "missing" };
  }
  if (msg.direction !== "IN" || msg.source !== "CUSTOMER") {
    return { skipped: "not_customer_inbound" };
  }
  const session = msg.session;
  if (session.endedAt) return { skipped: "session_ended" };
  if (session.mode !== "AI") return { skipped: "manual_mode" };

  const tenantId = session.chat.tenantId;
  const cfg = await getSettings(tenantId, [
    "ai.global_enabled",
    "ai.max_replies_per_session",
    "handover.human_request_enabled",
    "handover.human_request_keywords",
    "handover.negative_sentiment_enabled",
    "handover.negative_sentiment_keywords",
  ]);

  // Gate: 10-cap. Auto-MANUAL trigger.
  const cap = Number(cfg["ai.max_replies_per_session"] ?? 10);
  if (session.aiReplyCount >= cap) {
    await escalateToManual(session, "AI_REPLY_LIMIT", tenantId);
    return { skipped: "cap_reached" };
  }

  // M11.B3 Gate: keyword-driven handover. Cheap pre-AI check. Two
  // separately-toggleable detectors share one entry point so we don't
  // double-fire (human-request wins if both match).
  const detect = evaluateHandover(msg.body, cfg);
  if (detect.flip) {
    log.info("keyword handover triggered", {
      sessionId: session.id,
      reason: detect.reason,
      matched: detect.matched,
    });
    await escalateToManual(session, detect.reason, tenantId);
    return { skipped: "handover_keyword", reason: detect.reason, matched: detect.matched };
  }

  // Gate: global AI off → fallback (don't flip MANUAL automatically).
  // Customer keeps getting fallback messages until cap → then escalates.
  if (cfg["ai.global_enabled"] === false) {
    await sendFallbackMessage({ session, tenantId, reason: "global_ai_off" });
    return { skipped: "ai_off_fallback" };
  }

  // Gate: campaign with no KB groups → fallback. Same logic — keep
  // mode=AI; the customer sees the FALLBACK template; eventually the cap
  // bites and only then do we escalate.
  if (!session.campaign || session.campaign.kbGroups.length === 0) {
    log.warn("session has no campaign or no KB groups; sending fallback", {
      sessionId: session.id,
    });
    await sendFallbackMessage({ session, tenantId, reason: "no_kb_groups" });
    return { skipped: "no_kb_groups_fallback" };
  }

  await enqueueKbSearch(messageId);
  log.info("enqueued kb-search", { messageId });
  return { ok: true };
}

// Hard auto-MANUAL escalation. Reserved for the cap (and future explicit
// auto triggers like keyword detectors). Pushes to manual queue and sends
// the MANUAL_HANDOFF template.
async function escalateToManual(session, reason, tenantId) {
  await flipSessionToManual(session.id, reason);
  await pushToManualQueue({
    chatId: session.chatId,
    sessionId: session.id,
    reason,
  });

  const text = await renderTemplate(tenantId, "MANUAL_HANDOFF");
  if (text) {
    const out = await prisma.message.create({
      data: {
        sessionId: session.id,
        direction: "OUT",
        source: "SYSTEM",
        body: text,
        kbChunkIds: [],
        // No `confidence` set — this message must NOT bump ai_reply_count
        // (the cap was already exceeded; bumping again would double-count).
      },
    });
    emitChatMessage({ ...out, chatId: session.chatId });
    // No delayMs — SYSTEM handoff template gets the same human-paced
    // delay + typing simulation as AI replies.
    await enqueueOutbound(out.id);
  }
  log.info("escalated to MANUAL", { sessionId: session.id, reason });
}
