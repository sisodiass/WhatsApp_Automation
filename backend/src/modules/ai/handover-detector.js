// M11.B3 — confidence-driven handover detector.
//
// Cheap, deterministic keyword matching that runs on every inbound
// customer message BEFORE the AI gates fire. No AI round trip, no token
// cost. Two independent signals:
//
//   1. Human-request:   customer explicitly asks for a human (default ON).
//                       Hard escalation with ManualReason.KEYWORD_TRIGGER.
//   2. Negative sentiment: customer is frustrated/angry (default OFF —
//                       opt-in because false positives risk over-routing).
//                       Hard escalation with ManualReason.NEGATIVE_SENTIMENT.
//
// Both lists are operator-tunable via settings:
//   handover.human_request_enabled       (bool, default true)
//   handover.human_request_keywords      (comma-separated, lowercase)
//   handover.negative_sentiment_enabled  (bool, default false)
//   handover.negative_sentiment_keywords (comma-separated, lowercase)
//
// Matching rules:
//   - Lowercase + collapse whitespace + strip leading/trailing punctuation.
//   - Word-boundary regex so "humanitarian" doesn't match "human", but
//     multi-word phrases ("talk to a person") match as substring.
//   - Returns the matched keyword so it can be logged on the
//     ManualQueueItem for operator visibility.

const DEFAULT_HUMAN_REQUEST = [
  "human",
  "real person",
  "real human",
  "agent",
  "speak to someone",
  "talk to a person",
  "talk to someone",
  "representative",
  "customer service",
  "customer support",
  "live person",
  "support team",
  "actual person",
];

const DEFAULT_NEGATIVE_SENTIMENT = [
  "frustrated",
  "angry",
  "furious",
  "terrible",
  "awful",
  "unacceptable",
  "refund",
  "cancel my",
  "disappointed",
  "unhappy",
  "worst",
  "useless",
  "scam",
  "fraud",
  "complaint",
  "lawsuit",
];

function normalize(text) {
  if (!text) return "";
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
}

function parseKeywords(raw, fallback) {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : fallback;
}

// Match a single keyword/phrase against the normalized text.
// - Single token (no spaces) → match on word boundary.
// - Multi-word phrase → match as a contiguous substring with whitespace
//   flexibility (one or more spaces between words).
function phraseMatches(text, kw) {
  if (!kw) return false;
  if (!/\s/.test(kw)) {
    const re = new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i");
    return re.test(text);
  }
  const pattern = kw.split(/\s+/).map(escapeRegExp).join("\\s+");
  return new RegExp(`\\b${pattern}\\b`, "i").test(text);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstMatch(text, keywords) {
  for (const kw of keywords) {
    if (phraseMatches(text, kw)) return kw;
  }
  return null;
}

/**
 * @param {string} body - the customer's message text
 * @param {object} settings - the settings map (see top of file for keys)
 * @returns {{ flip: boolean, reason: "KEYWORD_TRIGGER"|"NEGATIVE_SENTIMENT"|null,
 *             matched: string|null }}
 */
export function evaluateHandover(body, settings) {
  const text = normalize(body);
  if (!text) return { flip: false, reason: null, matched: null };

  const humanEnabled = settings["handover.human_request_enabled"] !== false;
  if (humanEnabled) {
    const kws = parseKeywords(
      settings["handover.human_request_keywords"],
      DEFAULT_HUMAN_REQUEST,
    );
    const hit = firstMatch(text, kws);
    if (hit) return { flip: true, reason: "KEYWORD_TRIGGER", matched: hit };
  }

  // Negative sentiment is opt-in. Default false because false positives
  // on words like "refund" / "cancel" could escalate routine queries.
  const sentimentEnabled = settings["handover.negative_sentiment_enabled"] === true;
  if (sentimentEnabled) {
    const kws = parseKeywords(
      settings["handover.negative_sentiment_keywords"],
      DEFAULT_NEGATIVE_SENTIMENT,
    );
    const hit = firstMatch(text, kws);
    if (hit) return { flip: true, reason: "NEGATIVE_SENTIMENT", matched: hit };
  }

  return { flip: false, reason: null, matched: null };
}

export const HANDOVER_DETECTOR_DEFAULTS = {
  human: DEFAULT_HUMAN_REQUEST,
  negative: DEFAULT_NEGATIVE_SENTIMENT,
};
