// Anthropic Claude provider. Native HTTPS — no SDK dep so the install
// footprint stays tight (mirrors the Razorpay/Stripe payment providers).
//
// Anthropic Messages API:
//   POST https://api.anthropic.com/v1/messages
//   Headers: x-api-key, anthropic-version, content-type
//   Body:    { model, max_tokens, system, messages: [{role, content}] }
//
// Claude does NOT publish first-party embedding models. To stay drop-in
// compatible with the rest of the AI pipeline (KB embed + retrieval), this
// provider's `embedBatch` delegates to a separate embedding provider
// resolved at call time (default OpenAI). The factory wires that delegate
// via `embedDelegate` so the cache key stays clean.

import { REQUIRED_EMBED_DIM } from "./base.js";

const NAME = "claude";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export function createClaudeProvider({ apiKey, chatModel, embedModel, embedDelegate }) {
  if (!apiKey) {
    throw new Error("claude provider: ANTHROPIC_API_KEY missing");
  }
  if (!embedDelegate) {
    // The factory MUST inject an embed delegate (an OpenAI/Gemini provider).
    // Without it, KB ingest breaks. We fail loudly here rather than silently
    // at the first embedBatch call.
    throw new Error(
      "claude provider: embedDelegate (an OpenAI or Gemini provider) required — " +
        "Claude has no native embedding API. Configure ai.embedding_provider in Settings.",
    );
  }

  async function callMessages({ systemPrompt, userPrompt, signal, maxTokens = 400 }) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: chatModel,
        max_tokens: maxTokens,
        temperature: 0.1,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`claude: non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`claude: ${msg}`);
    }
    return data;
  }

  return {
    name: NAME,
    chatModel,
    embedModel,
    embedDim: REQUIRED_EMBED_DIM,

    // Delegated. Claude doesn't publish embeddings; we route to whatever
    // provider is configured under ai.embedding_provider. The delegate is
    // a fully-constructed provider object (same factory path), so cache
    // invalidation cascades correctly when its credentials change.
    async embedBatch(texts) {
      return embedDelegate.embedBatch(texts);
    },

    async generateReply({ systemPrompt, userPrompt, timeoutMs = 15_000, signal }) {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(new Error("ai timeout")), timeoutMs);
      if (signal) signal.addEventListener("abort", () => ac.abort(signal.reason));
      try {
        const data = await callMessages({
          systemPrompt,
          userPrompt,
          signal: ac.signal,
        });
        // content is an array of blocks; pick the first text block.
        const block = (data.content || []).find((b) => b.type === "text");
        const text = block?.text?.trim() || "";
        if (!text) throw new Error("empty completion");
        return {
          text,
          model: data.model || chatModel,
          usage: data.usage
            ? {
                promptTokens: data.usage.input_tokens,
                completionTokens: data.usage.output_tokens,
                totalTokens:
                  (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
              }
            : null,
        };
      } finally {
        clearTimeout(timeout);
      }
    },

    async healthCheck() {
      const result = {
        provider: NAME,
        ok: false,
        embed: { ok: false, model: embedModel },
        chat: { ok: false, model: chatModel },
      };
      try {
        const v = await this.embedBatch(["health check"]);
        if (v[0]?.length === REQUIRED_EMBED_DIM) result.embed.ok = true;
      } catch (err) {
        result.embed.error = err.message;
      }
      try {
        const r = await this.generateReply({
          systemPrompt: "Reply with exactly: ok",
          userPrompt: "ping",
          timeoutMs: 8000,
        });
        if (r.text) result.chat.ok = true;
      } catch (err) {
        result.chat.error = err.message;
      }
      result.ok = result.embed.ok && result.chat.ok;
      return result;
    },
  };
}
