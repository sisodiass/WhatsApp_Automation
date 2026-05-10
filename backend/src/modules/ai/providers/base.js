// AI provider interface. JSDoc here; the rest of the app codes against the
// shape, not a specific implementation. Add a new provider by exporting
// an object with the same fields and registering it in providers/index.js.
//
// All providers MUST produce 1536-dim embeddings to fit kb_chunks.embedding.
// If a future provider's native dim differs, configure it to project to 1536
// (Gemini supports outputDimensionality; others may need PCA / Matryoshka).
//
// All providers MUST honor the strict KB-only system prompt (passed by the
// caller). They MUST NOT inject their own preamble that softens the rules.

export const REQUIRED_EMBED_DIM = 1536;

/**
 * @typedef {object} GenerateReplyInput
 * @property {string} systemPrompt
 * @property {string} userPrompt
 * @property {number} [timeoutMs]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} GenerateReplyOutput
 * @property {string} text
 * @property {string} model
 * @property {{ promptTokens?: number, completionTokens?: number, totalTokens?: number } | null} usage
 */

/**
 * @typedef {object} HealthResult
 * @property {boolean} ok
 * @property {string} provider
 * @property {{ ok: boolean, model: string, error?: string }} embed
 * @property {{ ok: boolean, model: string, error?: string }} chat
 */

/**
 * @typedef {object} AIProvider
 * @property {string} name        — short id used as `embedding_provider` value
 * @property {string} chatModel
 * @property {string} embedModel
 * @property {number} embedDim    — must equal REQUIRED_EMBED_DIM
 * @property {(texts: string[]) => Promise<number[][]>} embedBatch
 * @property {(input: GenerateReplyInput) => Promise<GenerateReplyOutput>} generateReply
 * @property {() => Promise<HealthResult>} healthCheck
 */
