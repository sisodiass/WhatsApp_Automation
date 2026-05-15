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
// M11.B2: intent classifier values. Orthogonal to score — describes
// the customer's latest stance independent of how qualified they are.
const INTENT_VALUES = new Set([
  "PURCHASE_INTENT",
  "OBJECTION",
  "QUESTION",
  "RESEARCHING",
  "OFF_TOPIC",
]);
// Curated allowlist for buyingSignals — keeps the field usable as a tag
// facet. Unknown tags from the AI are dropped rather than failing the
// scoring pass.
const KNOWN_SIGNALS = new Set([
  "budget_mentioned",
  "urgency_expressed",
  "decision_maker_confirmed",
  "comparison_shopping",
  "payment_method_asked",
  "demo_requested",
  "team_size_mentioned",
  "integration_asked",
  "contract_terms_asked",
]);

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

  // M11.B2: intent + buying signals. Both are optional in the AI response
  // (older prompts didn't emit them) — default to safe values rather than
  // failing the scoring pass.
  const rawIntent = String(parsed.intent || "").toUpperCase();
  const intent = INTENT_VALUES.has(rawIntent) ? rawIntent : null;
  const buyingSignals = Array.isArray(parsed.buyingSignals)
    ? parsed.buyingSignals
        .map((s) => String(s || "").toLowerCase())
        .filter((s) => KNOWN_SIGNALS.has(s))
    : [];

  // Merge memory: existing keys are preserved unless the AI explicitly
  // overwrites them. AI is told to carry-forward known facts, so this is
  // belt-and-braces. Intent + signals are stamped on top so downstream
  // automations + the UI can read them without re-running the AI.
  const mergedMemory = {
    ...(lead.memory?.memory || {}),
    ...memory,
    ...(intent ? { last_intent: intent } : {}),
    ...(buyingSignals.length ? { buying_signals: buyingSignals } : {}),
  };

  // Persist score + memory + activity in one transaction.
  await prisma.$transaction([
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
          intent,
          buyingSignals,
          reasoning,
        },
      },
    }),
  ]);

  log.info("scored lead", { leadId, score, aiScore, intent, provider: provider.name });

  // M11.B2 AI-to-quote bridge. When the AI flags a HOT lead with explicit
  // PURCHASE_INTENT, draft a quotation and route it to the manual review
  // queue. Failures here MUST NOT fail the score endpoint — operators
  // would lose visibility on intent if scoring kept 500'ing.
  let autoDraftedQuotationId = null;
  if (score === "HOT" && intent === "PURCHASE_INTENT") {
    try {
      autoDraftedQuotationId = await maybeAutoDraftQuote({
        tenantId,
        leadId,
        memory: mergedMemory,
        buyingSignals,
      });
    } catch (err) {
      // Best-effort. Log + carry on; the operator still sees the HOT score.
      log.warn("auto-draft quote failed", { leadId, err: err.message });
    }
  }

  return {
    score,
    aiScore,
    intent,
    buyingSignals,
    reasoning,
    memory: mergedMemory,
    model: provider.chatModel,
    autoDraftedQuotationId,
  };
}

// ─── AI-to-quote bridge ─────────────────────────────────────────────
// Idempotent: skips if any DRAFT or SENT quote already exists for the
// lead (operator may be mid-flight). When invoked, creates a placeholder
// quote (qty=1, unit=0) that the operator fills in via the editor; the
// review handoff is via the ManualQueueItem with reason AI_QUOTATION_REVIEW.

async function maybeAutoDraftQuote({ tenantId, leadId, memory, buyingSignals }) {
  const existing = await prisma.quotation.findFirst({
    where: {
      tenantId,
      leadId,
      deletedAt: null,
      status: { in: ["DRAFT", "SENT"] },
    },
    select: { id: true },
  });
  if (existing) {
    log.info("auto-draft skipped — existing quote", { leadId, quotationId: existing.id });
    return null;
  }

  // Late import to avoid a circular dep: quotation.service imports from
  // scoring is unlikely, but we want lazy resolution so module load order
  // in workers doesn't matter.
  const { draftFromAiSuggestion } = await import("../quotations/quotation.service.js");
  const interestedProduct = String(memory?.interested_product || "").trim();
  const description = interestedProduct
    ? `${interestedProduct} (auto-drafted — review pricing)`
    : "AI-detected purchase intent — review and add product lines";

  const quote = await draftFromAiSuggestion(tenantId, {
    leadId,
    items: [
      {
        description,
        qty: 1,
        unitPrice: 0,
        taxRatePct: 0,
      },
    ],
    notes: [
      "Auto-drafted by AI on PURCHASE_INTENT detection.",
      buyingSignals.length ? `Signals: ${buyingSignals.join(", ")}.` : "",
      memory?.budget ? `Customer-mentioned budget: ${memory.budget}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
  log.info("auto-drafted quote", { leadId, quotationId: quote.id, number: quote.number });
  return quote.id;
}

// ─── Suggested replies ──────────────────────────────────────────────

// M11.B4: suggestion mode picker. Pure function — easy to unit test.
// Objection wins over upsell when both apply, since closing an objection
// is higher leverage than expanding the cart.
function pickSuggestionMode({ lastIntent, score, hasCandidateProducts }) {
  if (lastIntent === "OBJECTION") return "objection-handling";
  if (score === "HOT" && hasCandidateProducts) return "upsell-aware";
  return "default";
}

// Pull up to N active products that look related to the customer's
// interested_product (case-insensitive contains match on name). Falls
// back to most-recent active products when no interest is recorded.
// Returns just the fields the prompt needs.
async function fetchCandidateProducts(tenantId, interestedProduct, limit = 5) {
  const where = {
    tenantId,
    status: "ACTIVE",
    deletedAt: null,
    ...(interestedProduct
      ? { name: { contains: interestedProduct, mode: "insensitive" } }
      : {}),
  };
  const rows = await prisma.product.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true, name: true, basePrice: true, currency: true },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    basePrice: p.basePrice ? p.basePrice.toString() : null,
    currency: p.currency || null,
  }));
}

export async function suggestReplies(tenantId, chatId, opts = {}) {
  const tone = SUGGEST_TONES.has(opts.tone) ? opts.tone : "professional";

  const chat = await prisma.chat.findFirst({
    where: { id: chatId, tenantId },
    include: {
      contact: {
        select: {
          firstName: true,
          lastName: true,
          mobile: true,
          // M11.B4: most-recent lead for this contact, with memory.
          // Drives the context-aware prompt mode below. Lead is
          // hard-deleted (no soft-delete column), so we just take the
          // most recent by updatedAt.
          leads: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: {
              id: true,
              score: true,
              memory: { select: { memory: true } },
            },
          },
        },
      },
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

  // M11.B4: extract lead context. All optional — when none of this is
  // populated, the prompt falls back to the original M7 generic mode.
  const lead = chat.contact?.leads?.[0];
  const memory = lead?.memory?.memory || {};
  const lastIntent = typeof memory.last_intent === "string" ? memory.last_intent : null;
  const lastObjection = typeof memory.last_objection === "string" ? memory.last_objection : null;
  const interestedProduct =
    typeof memory.interested_product === "string" ? memory.interested_product : null;
  const score = lead?.score || null;

  // Upsell-aware needs candidate products. Skip the catalog read when the
  // lead isn't HOT — saves a query on the common path.
  const candidateProducts =
    score === "HOT" ? await fetchCandidateProducts(tenantId, interestedProduct) : [];

  const mode = pickSuggestionMode({
    lastIntent,
    score,
    hasCandidateProducts: candidateProducts.length > 0,
  });

  const provider = await getProvider();
  const systemPrompt = buildSuggestionsPrompt(tone, {
    mode,
    lastObjection,
    interestedProduct,
    candidateProducts,
  });
  const userPrompt = [
    `Customer: ${[chat.contact?.firstName, chat.contact?.lastName].filter(Boolean).join(" ") || chat.contact?.mobile || "(unknown)"}`,
    score ? `Lead score: ${score}` : "",
    lastIntent ? `Last detected intent: ${lastIntent}` : "",
    "",
    "Conversation so far:",
    renderConversation(messages),
  ]
    .filter(Boolean)
    .join("\n");

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
  return {
    tone,
    suggestions,
    model: provider.chatModel,
    // M11.B4 metadata so the UI can render a mode badge / product chips
    // without re-fetching anything.
    mode,
    intent: lastIntent,
    score,
    candidateProducts,
  };
}
