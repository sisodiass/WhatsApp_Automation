// Provider-agnostic embedding facade. Resolves the active provider per call
// (the factory caches by signature so this is cheap), then delegates.

import { getProvider } from "../ai/providers/index.js";
import { REQUIRED_EMBED_DIM } from "../ai/providers/base.js";

export const EMBED_DIM = REQUIRED_EMBED_DIM;

export async function embedBatch(texts) {
  const provider = await getProvider();
  return provider.embedBatch(texts);
}

// Returns { name, model } for the currently active provider. Used by the
// KB processor (to stamp chunks) and retrieval (to filter on a matching
// provider+model so vectors from prior models are ignored).
export async function getActiveEmbeddingStamp() {
  const provider = await getProvider();
  return { name: provider.name, model: provider.embedModel };
}

// Formats a vector as a pgvector literal: "[1,2,3]". Column type is
// vector(1536); the cast `::vector` accepts it.
export function toVectorLiteral(vec) {
  return `[${vec.join(",")}]`;
}
