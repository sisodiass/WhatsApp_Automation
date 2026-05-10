// kb-search worker — runs hybrid retrieval, gates on confidence, generates
// the AI reply with the strict KB-only prompt, persists the OUT message,
// and enqueues outbound. ANY pipeline error (provider config missing,
// embedding failure, generation timeout, DB hiccup) routes through the
// fallback path — never bubble to BullMQ retries that leave the customer
// hanging silently.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { emitChatMessage } from "../../shared/socket.js";
import { getSettings } from "../../modules/settings/settings.service.js";
import { hybridSearch, topConfidence } from "../../modules/kb/retrieval.service.js";
import { generateAnswer, isFallbackReply } from "../../modules/ai/generation.service.js";
import { renderTemplate } from "../../modules/templates/template.service.js";
import { sendFallbackMessage } from "../../modules/ai/fallback.service.js";
import { enqueueOutbound } from "../../modules/queue/producers.js";

const log = child("q:kb-search");

export async function processKbSearchJob(job) {
  const { messageId } = job.data;

  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      session: {
        include: {
          chat: true,
          campaign: { include: { kbGroups: { select: { kbGroupId: true } } } },
        },
      },
    },
  });
  if (!msg) return { skipped: "missing" };

  const session = msg.session;
  if (session.endedAt) return { skipped: "session_ended" };
  if (session.mode !== "AI") return { skipped: "no_longer_ai" };

  const tenantId = session.chat.tenantId;
  const kbGroupIds = session.campaign?.kbGroups.map((k) => k.kbGroupId) ?? [];

  const cfg = await getSettings(tenantId, [
    "ai.confidence_threshold",
    "ai.generation_timeout_seconds",
  ]);
  const threshold = Number(cfg["ai.confidence_threshold"] ?? 0.82);
  const timeoutMs = Number(cfg["ai.generation_timeout_seconds"] ?? 15) * 1000;

  // Wrap the entire pipeline so any unexpected error (provider config
  // missing, embedding API down, DB hiccup) ends in a fallback message
  // instead of vanishing into BullMQ retries.
  try {
    return await runPipeline({ msg, session, tenantId, kbGroupIds, threshold, timeoutMs, messageId });
  } catch (err) {
    log.error("kb-search pipeline error; falling back", {
      messageId,
      err: err.message,
      stack: err.stack,
    });
    return sendFallback({
      session,
      tenantId,
      confidence: 0,
      reason: "pipeline_error",
    });
  }
}

async function runPipeline({ msg, session, tenantId, kbGroupIds, threshold, timeoutMs, messageId }) {
  // 1. Retrieve.
  const results = await hybridSearch({
    tenantId,
    kbGroupIds,
    query: msg.body,
    topK: 5,
  });
  const confidence = topConfidence(results);

  log.info("retrieved", {
    messageId,
    chunks: results.length,
    confidence: Number(confidence.toFixed(3)),
  });

  // 2. Confidence gate. POLICY: low confidence does NOT flip to MANUAL.
  //    We send the FALLBACK template so the customer gets a graceful
  //    response, count it toward the AI-reply cap, and keep mode=AI.
  //    Only the 10-cap escalation in incoming.worker auto-flips MANUAL.
  if (results.length === 0 || confidence < threshold) {
    return sendFallback({ session, tenantId, confidence, reason: "low_confidence" });
  }

  // 3. Generate. A6 timeout aborts → fall through to FALLBACK path.
  const fallback =
    (await renderTemplate(tenantId, "FALLBACK")) ||
    "I can currently assist only with topics available in our knowledge base.";

  let generated;
  try {
    generated = await generateAnswer({
      question: msg.body,
      contextChunks: results,
      fallbackMessage: fallback,
      timeoutMs,
    });
  } catch (err) {
    log.warn("generation failed; falling back", { messageId, err: err.message });
    return sendFallback({
      session,
      tenantId,
      confidence,
      reason: err.message === "ai timeout" ? "ai_timeout" : "ai_error",
    });
  }

  const replyText = generated.text;

  // 4. If the model honoured the rule and emitted the fallback (possibly
  //    with leaked formatting like FALLBACK: or quotes), treat as low
  //    confidence — never count this against the AI cap as a real reply.
  if (isFallbackReply(replyText, fallback)) {
    log.info("model returned fallback; sending fallback template", {
      messageId,
      raw: replyText.slice(0, 100),
    });
    return sendFallback({ session, tenantId, confidence, reason: "model_fallback" });
  }

  // 5. Persist the AI reply. ai_reply_count is bumped on OUTBOUND_ACK
  //    in whatsapp.consumer (so a never-sent message doesn't burn a slot).
  const chunkIds = results.map((r) => r.chunk.id);
  const out = await prisma.message.create({
    data: {
      sessionId: session.id,
      direction: "OUT",
      source: "AI",
      body: replyText,
      kbChunkIds: chunkIds,
      confidence,
    },
  });
  emitChatMessage({ ...out, chatId: session.chatId });

  await enqueueOutbound(out.id);
  log.info("enqueued AI reply", {
    messageId,
    outId: out.id,
    confidence: Number(confidence.toFixed(3)),
    chunks: chunkIds.length,
  });
  return { ok: true, outId: out.id };
}

// Thin wrapper around the shared sendFallbackMessage helper.
async function sendFallback({ session, tenantId, confidence, reason }) {
  const result = await sendFallbackMessage({
    session,
    tenantId,
    confidence,
    reason: reason || "low_confidence",
  });
  return { fallback: true, ...result, confidence };
}
