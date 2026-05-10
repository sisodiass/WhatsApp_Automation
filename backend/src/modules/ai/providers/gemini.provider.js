// Gemini provider via the @google/genai SDK.
//
// Embedding: gemini-embedding-001 with outputDimensionality=1536 so vectors
// fit kb_chunks.embedding without re-shaping. Vectors from Gemini live in a
// different semantic space than OpenAI's, so retrieval filters by the
// `embedding_provider` column to avoid mixing.

import { GoogleGenAI } from "@google/genai";
import { REQUIRED_EMBED_DIM } from "./base.js";

const NAME = "gemini";

export function createGeminiProvider({ apiKey, chatModel, embedModel }) {
  if (!apiKey) {
    throw new Error("gemini provider: GEMINI_API_KEY missing");
  }
  const ai = new GoogleGenAI({ apiKey });

  return {
    name: NAME,
    chatModel,
    embedModel,
    embedDim: REQUIRED_EMBED_DIM,

    async embedBatch(texts) {
      if (!texts.length) return [];
      // The SDK accepts an array of strings or content objects in `contents`.
      const res = await ai.models.embedContent({
        model: embedModel,
        contents: texts,
        config: { outputDimensionality: REQUIRED_EMBED_DIM },
      });
      const vectors = (res.embeddings || []).map((e) => e.values || e);
      if (!vectors.length || vectors.length !== texts.length) {
        throw new Error(
          `gemini embedBatch: expected ${texts.length} vectors, got ${vectors.length}`,
        );
      }
      if (vectors[0].length !== REQUIRED_EMBED_DIM) {
        throw new Error(
          `gemini embedModel "${embedModel}" returned dim=${vectors[0].length}, ` +
            `but kb_chunks.embedding expects ${REQUIRED_EMBED_DIM}`,
        );
      }
      return vectors;
    },

    async generateReply({ systemPrompt, userPrompt, timeoutMs = 15_000, signal }) {
      // The Gemini SDK doesn't accept AbortSignal directly on generateContent
      // in all releases; wrap in Promise.race to enforce the A6 timeout.
      const ac = new AbortController();
      if (signal) signal.addEventListener("abort", () => ac.abort(signal.reason));

      const call = ai.models.generateContent({
        model: chatModel,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.1,
          maxOutputTokens: 400,
        },
      });

      const timeoutPromise = new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error("ai timeout")), timeoutMs);
        ac.signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(ac.signal.reason || new Error("aborted"));
        });
      });

      const res = await Promise.race([call, timeoutPromise]);

      // .text is a convenience getter on the new SDK; fall back to the
      // structured form if it's absent.
      const text =
        (typeof res.text === "string" && res.text.trim()) ||
        res?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() ||
        "";
      if (!text) throw new Error("empty completion");

      const usage = res.usageMetadata
        ? {
            promptTokens: res.usageMetadata.promptTokenCount,
            completionTokens: res.usageMetadata.candidatesTokenCount,
            totalTokens: res.usageMetadata.totalTokenCount,
          }
        : null;

      return { text, model: chatModel, usage };
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
