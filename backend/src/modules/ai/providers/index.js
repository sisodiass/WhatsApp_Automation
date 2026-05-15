// Provider factory. Reads the active provider + per-provider model from
// the settings table, and resolves API keys from settings first then env.
// Caches a single instance per (provider, models, key-fingerprint) signature.
// Call `invalidateProvider()` after a relevant settings update so the next
// caller picks up the change.

import crypto from "node:crypto";
import { config } from "../../../config/index.js";
import { child } from "../../../shared/logger.js";
import { getDefaultTenantId } from "../../../shared/tenant.js";
import { prisma } from "../../../shared/prisma.js";
import { decrypt } from "../../../utils/crypto.js";
import { createOpenAIProvider } from "./openai.provider.js";
import { createGeminiProvider } from "./gemini.provider.js";
import { createClaudeProvider } from "./claude.provider.js";

const log = child("ai-provider");

// To avoid a circular import (settings.service imports invalidateProvider
// from this file), we read settings rows directly here instead of using
// settings.service's helpers.
async function readSettings(tenantId, keys) {
  const rows = await prisma.setting.findMany({
    where: { tenantId, key: { in: keys } },
  });
  const out = {};
  for (const r of rows) {
    if (r.encrypted) {
      try {
        out[r.key] = decrypt(r.value);
      } catch {
        // skip — corrupted / wrong key
      }
    } else {
      out[r.key] = r.value;
    }
  }
  return out;
}

// Build a fully-constructed openai/gemini provider from settings. Used
// directly for those two providers, and as the embed-delegate when the
// active provider is "claude" (Claude has no native embeddings).
function buildBaseProvider(name, cfg) {
  let apiKey, chatModel, embedModel;
  if (name === "openai") {
    apiKey = cfg["ai.openai.api_key"] || config.openai.apiKey;
    chatModel = cfg["ai.openai.chat_model"] || config.openai.chatModel;
    embedModel = cfg["ai.openai.embedding_model"] || config.openai.embedModel;
    return {
      provider: createOpenAIProvider({ apiKey, chatModel, embedModel }),
      apiKey,
      chatModel,
      embedModel,
    };
  }
  if (name === "gemini") {
    apiKey = cfg["ai.gemini.api_key"] || config.gemini.apiKey;
    chatModel = cfg["ai.gemini.chat_model"] || config.gemini.chatModel;
    embedModel = cfg["ai.gemini.embedding_model"] || config.gemini.embedModel;
    return {
      provider: createGeminiProvider({ apiKey, chatModel, embedModel }),
      apiKey,
      chatModel,
      embedModel,
    };
  }
  throw new Error(`buildBaseProvider: unsupported provider "${name}"`);
}

const REGISTRY = {
  openai: true,
  gemini: true,
  claude: true,
};

let cached = null; // { signature, provider }

function fingerprint(s) {
  if (!s) return "none";
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
}

function signature(parts) {
  return parts
    .map((p) => (p == null ? "none" : typeof p === "string" ? p : JSON.stringify(p)))
    .join("|");
}

export async function getProvider() {
  // Dev-only: when AI_STUB=true the factory returns a deterministic
  // provider that emits canned JSON for the two prompts the M7 scoring
  // module uses. Lets developers smoke-test scoring + suggested replies
  // without an AI API key and without exhausting a quota. NEVER set
  // AI_STUB in production — bot replies will be hard-coded.
  if (process.env.AI_STUB === "true") {
    return STUB_PROVIDER;
  }
  const tenantId = await getDefaultTenantId();
  const cfg = await readSettings(tenantId, [
    "ai.provider",
    // M11.B: when the active provider is Claude (chat-only), this names
    // which provider supplies embeddings. Defaults to "openai".
    "ai.embedding_provider",
    "ai.openai.api_key",
    "ai.openai.chat_model",
    "ai.openai.embedding_model",
    "ai.gemini.api_key",
    "ai.gemini.chat_model",
    "ai.gemini.embedding_model",
    "ai.claude.api_key",
    "ai.claude.chat_model",
  ]);

  const name = String(cfg["ai.provider"] || "openai").toLowerCase();
  if (!REGISTRY[name]) throw new Error(`unknown ai provider "${name}"`);

  if (name === "openai" || name === "gemini") {
    const built = buildBaseProvider(name, cfg);
    const sig = signature([
      name,
      built.chatModel,
      built.embedModel,
      fingerprint(built.apiKey),
    ]);
    if (cached && cached.signature === sig) return cached.provider;
    log.info("instantiating provider", {
      name,
      chatModel: built.chatModel,
      embedModel: built.embedModel,
      keySource: cfg[`ai.${name}.api_key`] ? "settings" : "env",
    });
    cached = { signature: sig, provider: built.provider };
    return built.provider;
  }

  // claude: chat-only. Delegate embeddings to ai.embedding_provider
  // (default openai). The embed delegate is a full provider object built
  // from the same settings table, so a credential change on the embed
  // side propagates correctly via invalidateProvider().
  const embedName = String(cfg["ai.embedding_provider"] || "openai").toLowerCase();
  if (embedName === "claude") {
    throw new Error(
      `ai.embedding_provider cannot be "claude" — pick openai or gemini`,
    );
  }
  if (!REGISTRY[embedName] || embedName === "claude") {
    throw new Error(`unknown ai.embedding_provider "${embedName}"`);
  }
  const embedBuilt = buildBaseProvider(embedName, cfg);

  const claudeKey = cfg["ai.claude.api_key"] || config.claude?.apiKey;
  const claudeChat = cfg["ai.claude.chat_model"] || config.claude?.chatModel || "claude-3-5-sonnet-latest";
  const sig = signature([
    "claude",
    claudeChat,
    embedName,
    embedBuilt.embedModel,
    fingerprint(claudeKey),
    fingerprint(embedBuilt.apiKey),
  ]);
  if (cached && cached.signature === sig) return cached.provider;
  log.info("instantiating provider", {
    name: "claude",
    chatModel: claudeChat,
    embedDelegate: embedName,
    embedModel: embedBuilt.embedModel,
    keySource: cfg["ai.claude.api_key"] ? "settings" : "env",
  });
  const provider = createClaudeProvider({
    apiKey: claudeKey,
    chatModel: claudeChat,
    embedModel: embedBuilt.embedModel,
    embedDelegate: embedBuilt.provider,
  });
  cached = { signature: sig, provider };
  return provider;
}

export function invalidateProvider() {
  cached = null;
}

export function listProviders() {
  return Object.keys(REGISTRY);
}

// Dev stub — see getProvider's AI_STUB branch. Emits JSON that round-trips
// the M7 prompts (scoring + suggestions). Embedding stub is also provided
// so KB upload still works in dev environments without an AI key.
const STUB_PROVIDER = {
  name: "stub",
  chatModel: "stub-model",
  embedModel: "stub-embed",
  embedDim: 1536,
  async embedBatch(texts) {
    return texts.map(() => Array(1536).fill(0));
  },
  async generateReply({ systemPrompt }) {
    if (/classifies WhatsApp leads/.test(systemPrompt)) {
      return {
        text: JSON.stringify({
          score: "HOT",
          aiScore: 0.87,
          // M11.B2: stub emits intent + buyingSignals so tests can drive
          // the AI-to-quote bridge without a real model.
          intent: "PURCHASE_INTENT",
          buyingSignals: [
            "budget_mentioned",
            "urgency_expressed",
            "decision_maker_confirmed",
            "demo_requested",
          ],
          reasoning: "Has budget, urgency, and explicit demo ask.",
          memory: {
            budget: "50000 INR/mo",
            interested_product: "WhatsApp CRM",
            buying_timeline: "this week",
            decision_maker_role: "evaluator",
          },
        }),
        model: "stub-model",
      };
    }
    if (/suggesting reply options/.test(systemPrompt)) {
      // M11.B4: stub branches on the mode hint embedded in the system
      // prompt so tests can exercise each mode without a real model.
      if (/MODE: objection-handling/.test(systemPrompt)) {
        return {
          text: JSON.stringify({
            suggestions: [
              "Totally hear you on the price — let me show you the actual ROI numbers from a similar customer.",
              "We've found teams typically save 8-12 hours/week with this; happy to share the math.",
              "Want to try a 14-day pilot at no cost? That way you only commit once you see the value.",
            ],
          }),
          model: "stub-model",
        };
      }
      if (/MODE: upsell-aware/.test(systemPrompt)) {
        return {
          text: JSON.stringify({
            suggestions: [
              "Glad the Pro plan landed well — would the Analytics add-on help your reporting needs?",
              "Should I lock in the deal today? I can include onboarding training if you'd like.",
              "Quick check — do you also need the priority support tier? Most teams your size add it.",
            ],
          }),
          model: "stub-model",
        };
      }
      return {
        text: JSON.stringify({
          suggestions: [
            "Happy to set up the demo this week — does Wednesday 2pm IST work?",
            "Great timing! I'll have our solutions team walk you through the Pro plan. Best day to schedule?",
            "Sure — sending a calendar link now. Anyone else from your team should join?",
          ],
        }),
        model: "stub-model",
      };
    }
    return { text: "(stub response)", model: "stub-model" };
  },
  async healthCheck() {
    return { provider: "stub", ok: true, embed: { ok: true }, chat: { ok: true } };
  },
};
