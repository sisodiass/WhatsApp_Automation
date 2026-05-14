// AI lead scoring + suggested replies.
//
// Both flows share the provider factory + a small JSON-emit prompt. Both
// run in the API process (request-response). For very heavy workloads
// we'd move scoring to a worker queue, but the latency budget here is a
// single provider round trip (~1-3s), well within an HTTP request.

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { BadRequest, NotFound } from "../../shared/errors.js";
import { getProvider } from "./providers/index.js";
import {
  buildScoringPrompt,
  buildSuggestionsPrompt,
  parseJsonResponse,
  renderConversation,
} from "./prompts.js";

const log = child("ai-scoring");

const SCORE_BUCKETS = new Set(["HOT", "WARM", "COLD", "UNQUALIFIED"]);
const SUGGEST_TONES = new Set(["professional", "friendly", "brief"]);

// How many recent messages we hand the AI for context. 30 is a balance
// between coverage and token cost; for v1 we don't summarize older history.
const HISTORY_LIMIT = 30;

// ─── Lead scoring ───────────────────────────────────────────────────

export async function scoreLead(tenantId, leadId, actorId) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: {
      contact: { include: { chats: { take: 1, orderBy: { lastMessageAt: "desc" } } } },
      memory: true,
    },
  });
  if (!lead) throw NotFound("lead not found");
  const chat = lead.contact?.chats?.[0];
  if (!chat) throw BadRequest("contact has no chat history — nothing to score from");

  const messages = await prisma.message.findMany({
    where: { session: { chatId: chat.id } },
    orderBy: { createdAt: "asc" },
    take: HISTORY_LIMIT,
    select: { direction: true, source: true, body: true, createdAt: true },
  });
  if (messages.length === 0) {
    throw BadRequest("no messages on this chat — cannot score");
  }

  const provider = await getProvider();
  const systemPrompt = buildScoringPrompt();
  const userPrompt = [
    "Conversation:",
    renderConversation(messages),
    "",
    "Known memory facts (may be empty):",
    JSON.stringify(lead.memory?.memory || {}, null, 2),
    "",
    "Lead source:",
    lead.source || "(unknown)",
  ].join("\n");

  const r = await provider.generateReply({ systemPrompt, userPrompt, timeoutMs: 20_000 });
  let parsed;
  try {
    parsed = parseJsonResponse(r.text);
  } catch (err) {
    log.warn("score JSON parse failed", { leadId, err: err.message, raw: r.text?.slice(0, 200) });
    throw BadRequest(`AI returned unparseable JSON: ${err.message}`);
  }

  const score = String(parsed.score || "").toUpperCase();
  if (!SCORE_BUCKETS.has(score)) {
    throw BadRequest(`AI returned invalid score "${parsed.score}"`);
  }
  const aiScore = Number(parsed.aiScore);
  if (!Number.isFinite(aiScore) || aiScore < 0 || aiScore > 1) {
    throw BadRequest(`AI returned invalid aiScore "${parsed.aiScore}"`);
  }
  const memory = parsed.memory && typeof parsed.memory === "object" ? parsed.memory : {};
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 500) : "";

  // Merge memory: existing keys are preserved unless the AI explicitly
  // overwrites them. AI is told to carry-forward known facts, so this is
  // belt-and-braces.
  const mergedMemory = { ...(lead.memory?.memory || {}), ...memory };

  // Persist score + memory + activity in one transaction.
  const [updatedLead] = await prisma.$transaction([
    prisma.lead.update({
      where: { id: leadId },
      data: { score, aiScore },
      select: { id: true, score: true, aiScore: true },
    }),
    prisma.leadMemory.upsert({
      where: { leadId },
      create: { leadId, memory: mergedMemory },
      update: { memory: mergedMemory },
    }),
    prisma.leadActivity.create({
      data: {
        leadId,
        kind: "AUTOMATION",
        actorId: actorId ?? null,
        data: {
          event: "ai_score",
          provider: provider.name,
          model: provider.chatModel,
          score,
          aiScore,
          reasoning,
        },
      },
    }),
  ]);

  log.info("scored lead", { leadId, score, aiScore, provider: provider.name });
  return { score, aiScore, reasoning, memory: mergedMemory, model: provider.chatModel };
}

// ─── Suggested replies ──────────────────────────────────────────────

export async function suggestReplies(tenantId, chatId, opts = {}) {
  const tone = SUGGEST_TONES.has(opts.tone) ? opts.tone : "professional";

  const chat = await prisma.chat.findFirst({
    where: { id: chatId, tenantId },
    include: {
      contact: { select: { firstName: true, lastName: true, mobile: true } },
    },
  });
  if (!chat) throw NotFound("chat not found");

  const messages = await prisma.message.findMany({
    where: { session: { chatId } },
    orderBy: { createdAt: "asc" },
    take: HISTORY_LIMIT,
    select: { direction: true, source: true, body: true, createdAt: true },
  });
  if (messages.length === 0) {
    throw BadRequest("no messages on this chat — nothing to suggest from");
  }

  const provider = await getProvider();
  const systemPrompt = buildSuggestionsPrompt(tone);
  const userPrompt = [
    `Customer: ${[chat.contact?.firstName, chat.contact?.lastName].filter(Boolean).join(" ") || chat.contact?.mobile || "(unknown)"}`,
    "",
    "Conversation so far:",
    renderConversation(messages),
  ].join("\n");

  const r = await provider.generateReply({ systemPrompt, userPrompt, timeoutMs: 15_000 });
  let parsed;
  try {
    parsed = parseJsonResponse(r.text);
  } catch (err) {
    log.warn("suggest JSON parse failed", { chatId, err: err.message, raw: r.text?.slice(0, 200) });
    throw BadRequest(`AI returned unparseable JSON: ${err.message}`);
  }
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  if (suggestions.length === 0) throw BadRequest("AI returned no usable suggestions");
  return { tone, suggestions, model: provider.chatModel };
}
