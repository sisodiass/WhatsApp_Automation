// Shared "AI can't answer this right now" path. Sends the FALLBACK
// template as a SYSTEM message and bumps ai_reply_count (via the
// confidence marker that markOutboundSent looks for). Does NOT flip
// the session to MANUAL — the only auto-MANUAL trigger is the
// 10-reply cap in incoming.worker.
//
// Used when:
//   - kb-search retrieval finds nothing or scores below threshold
//   - kb-search generation fails / times out
//   - incoming gate finds the campaign has no KB groups attached
//   - incoming gate finds global AI is off
//
// Counted toward the cap so a chat can't loop forever in fallback.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { emitChatMessage } from "../../shared/socket.js";
import { renderTemplate } from "../templates/template.service.js";
import { enqueueOutbound } from "../queue/producers.js";

const log = child("ai-fallback");

export async function sendFallbackMessage({ session, tenantId, confidence, reason }) {
  const fallback = await renderTemplate(tenantId, "FALLBACK");
  if (!fallback) {
    log.warn("FALLBACK template missing — cannot send fallback message", {
      sessionId: session.id,
    });
    return { sent: false };
  }

  // confidence on a SYSTEM message is the marker `markOutboundSent` uses
  // to bump ai_reply_count. Default to 0 so cases like "no KB groups"
  // (where there's literally no confidence to record) still count.
  const confValue = confidence ?? 0;

  const out = await prisma.message.create({
    data: {
      sessionId: session.id,
      direction: "OUT",
      source: "SYSTEM",
      body: fallback,
      kbChunkIds: [],
      confidence: confValue,
    },
  });
  emitChatMessage({ ...out, chatId: session.chatId });
  await enqueueOutbound(out.id, { delayMs: 0 });

  log.info("fallback sent (mode stays AI)", {
    sessionId: session.id,
    reason: reason || "low_confidence",
    confidence: confValue,
  });
  return { sent: true, messageId: out.id };
}
