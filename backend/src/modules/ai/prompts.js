// AI prompt library for lead scoring + suggested replies.
//
// These are intentionally in code (not the settings table) for v1 — the
// review notes about an admin prompt editor land in a separate task. To
// promote to settings later: each function reads the settings key with a
// matching name and falls back to the literal below.

export function buildScoringPrompt() {
  return [
    "You are a sales-qualification AI that classifies WhatsApp leads.",
    "Read the conversation and any known memory facts, then output ONLY a JSON object:",
    '{ "score": "HOT" | "WARM" | "COLD" | "UNQUALIFIED",',
    '  "aiScore": <number from 0.0 to 1.0>,',
    '  "reasoning": "<one sentence>",',
    '  "memory": { "<key>": "<value>", ... } }',
    "",
    "Score buckets:",
    "  HOT         — ready to buy / has budget + clear intent",
    "  WARM        — interested, needs nurturing, has objections",
    "  COLD        — early interest, no concrete signal",
    "  UNQUALIFIED — not a fit (wrong audience, bot, spam)",
    "",
    "memory should contain any facts worth remembering for next time —",
    "budget, interested_product, preferred_language, last_objection,",
    "buying_timeline, decision_maker_role. Use snake_case keys. Omit fields",
    "you cannot determine. Carry forward and refine prior memory facts.",
    "",
    "Output ONLY the JSON object. No prose, no markdown fence.",
  ].join("\n");
}

export function buildSuggestionsPrompt(tone) {
  const toneHint = {
    professional: "Use polished, business-appropriate phrasing.",
    friendly: "Use warm, conversational phrasing with light personality.",
    brief: "Be terse — under 20 words per option.",
  }[tone] || "Use natural conversational phrasing.";

  return [
    "You are an AI assistant suggesting reply options for a human sales agent on WhatsApp.",
    `Tone: ${tone}. ${toneHint}`,
    "Read the conversation. Suggest exactly 3 distinct reply options the agent could send NEXT.",
    "Each option should advance the conversation toward closing a sale — answer the customer,",
    "ask a qualifying question, or propose a next step. Vary the angle across the 3.",
    "",
    "Output ONLY a JSON object: { \"suggestions\": [\"...\", \"...\", \"...\"] }",
    "No prose, no markdown fence, no numbering inside the strings.",
  ].join("\n");
}

// Builds the user-side context payload that gets paired with the system
// prompt. We keep the recent conversation as a simple labelled transcript
// rather than chat-completions messages so the AI sees it as one block of
// "what happened so far" and can reason about it.
export function renderConversation(messages) {
  return messages
    .map((m) => {
      const who =
        m.direction === "IN"
          ? "CUSTOMER"
          : m.source === "AI"
          ? "AI"
          : m.source === "AGENT"
          ? "AGENT"
          : "SYSTEM";
      return `[${who}] ${m.body}`;
    })
    .join("\n");
}

// Attempts to parse a JSON object out of the AI's text response. Tolerates
// markdown code fences and stray prose around the JSON since not every
// chat model honors "ONLY JSON" instructions perfectly.
export function parseJsonResponse(text) {
  if (!text) throw new Error("empty response");
  // Strip ```json fences first.
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  // Find the first balanced {...} segment.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no JSON object in response");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}
