import OpenAI from "openai";
import { REQUIRED_EMBED_DIM } from "./base.js";

const NAME = "openai";

export function createOpenAIProvider({ apiKey, chatModel, embedModel }) {
  if (!apiKey) {
    throw new Error("openai provider: OPENAI_API_KEY missing");
  }
  const client = new OpenAI({ apiKey });

  return {
    name: NAME,
    chatModel,
    embedModel,
    embedDim: REQUIRED_EMBED_DIM,

    async embedBatch(texts) {
      if (!texts.length) return [];
      const res = await client.embeddings.create({
        model: embedModel,
        input: texts,
      });
      const out = res.data.map((d) => d.embedding);
      // text-embedding-3-small is natively 1536. Guard in case the operator
      // configures a different model whose default dim doesn't match.
      if (out[0].length !== REQUIRED_EMBED_DIM) {
        throw new Error(
          `openai embedModel "${embedModel}" returned dim=${out[0].length}, ` +
            `but kb_chunks.embedding expects ${REQUIRED_EMBED_DIM}`,
        );
      }
      return out;
    },

    async generateReply({ systemPrompt, userPrompt, timeoutMs = 15_000, signal }) {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(new Error("ai timeout")), timeoutMs);
      if (signal) signal.addEventListener("abort", () => ac.abort(signal.reason));

      try {
        const res = await client.chat.completions.create(
          {
            model: chatModel,
            temperature: 0.1,
            max_tokens: 400,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          },
          { signal: ac.signal },
        );
        const text = res.choices?.[0]?.message?.content?.trim() || "";
        if (!text) throw new Error("empty completion");
        return {
          text,
          model: res.model || chatModel,
          usage: res.usage
            ? {
                promptTokens: res.usage.prompt_tokens,
                completionTokens: res.usage.completion_tokens,
                totalTokens: res.usage.total_tokens,
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
