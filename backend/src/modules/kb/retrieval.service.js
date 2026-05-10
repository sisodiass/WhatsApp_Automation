// Hybrid retrieval = pgvector cosine top-N + Postgres tsvector top-N,
// merged via Reciprocal Rank Fusion. Returns top-K chunks with the
// max per-chunk vector similarity (used for the confidence gate) and
// the RRF score (used for ranking).
//
// Filters:
//   - chunk's document is_active = true
//   - chunk's document.kb_group is in `kbGroupIds`
//   - kb_group.tenant_id = `tenantId`
//
// Index requirements:
//   - HNSW on kb_chunks.embedding (vector_cosine_ops)
//   - GIN on kb_chunks.text_tsv
// Both are created idempotently in shared/db-init.js.

import { prisma } from "../../shared/prisma.js";
import {
  embedBatch,
  getActiveEmbeddingStamp,
  toVectorLiteral,
} from "./embeddings.js";

const PER_LIST = 20; // top-N per list before RRF merge
const RRF_K = 60;

export async function hybridSearch({ tenantId, kbGroupIds, query, topK = 5 }) {
  if (!query || !query.trim()) return [];
  if (!kbGroupIds || kbGroupIds.length === 0) return [];

  // 1. Embed the question with the active provider+model; we'll only
  //    compare against chunks stamped with the same (provider, model).
  const stamp = await getActiveEmbeddingStamp();
  const [vec] = await embedBatch([query]);
  const vecLit = toVectorLiteral(vec);

  // 2. Vector list (cosine similarity = 1 - distance). Filtering on
  //    (embedding_provider, embedding_model) keeps cross-provider AND
  //    cross-model chunks out of the candidate set — vectors from a
  //    different model live in a different semantic space, so mixing
  //    them produces noise.
  const vecRows = await prisma.$queryRawUnsafe(
    `
    SELECT c.id, c.text, c.document_id, d.kb_group_id, d.filename,
           1 - (c.embedding <=> $1::vector) AS sim
      FROM kb_chunks c
      JOIN kb_documents d ON d.id = c.document_id
     WHERE d.is_active = true
       AND d.kb_group_id = ANY($2::text[])
       AND d.kb_group_id IN (SELECT id FROM kb_groups WHERE tenant_id = $3)
       AND c.embedding IS NOT NULL
       AND c.embedding_provider = $5
       AND c.embedding_model = $6
     ORDER BY c.embedding <=> $1::vector
     LIMIT $4
    `,
    vecLit,
    kbGroupIds,
    tenantId,
    PER_LIST,
    stamp.name,
    stamp.model,
  );

  // 3. Keyword list. tsvector itself is provider-independent — every
  //    chunk's text is searchable regardless of which embedding model
  //    produced its vector. We still scope by (provider, model) so the
  //    RRF candidate set is coherent (a chunk with no current-config
  //    vector has no vecSim to merge against).
  const kwRows = await prisma.$queryRawUnsafe(
    `
    SELECT c.id, c.text, c.document_id, d.kb_group_id, d.filename,
           ts_rank(c.text_tsv, plainto_tsquery('english', $1)) AS rank
      FROM kb_chunks c
      JOIN kb_documents d ON d.id = c.document_id
     WHERE d.is_active = true
       AND d.kb_group_id = ANY($2::text[])
       AND d.kb_group_id IN (SELECT id FROM kb_groups WHERE tenant_id = $3)
       AND c.text_tsv @@ plainto_tsquery('english', $1)
       AND c.embedding_provider = $5
       AND c.embedding_model = $6
     ORDER BY rank DESC
     LIMIT $4
    `,
    query,
    kbGroupIds,
    tenantId,
    PER_LIST,
    stamp.name,
    stamp.model,
  );

  // 4. RRF merge.
  const map = new Map(); // chunkId → { score, vecSim, kwRank, chunk }
  vecRows.forEach((row, i) => {
    map.set(row.id, {
      score: 1 / (RRF_K + i + 1),
      vecSim: Number(row.sim) || 0,
      kwRank: 0,
      chunk: row,
    });
  });
  kwRows.forEach((row, i) => {
    const add = 1 / (RRF_K + i + 1);
    if (map.has(row.id)) {
      const e = map.get(row.id);
      e.score += add;
      e.kwRank = Number(row.rank) || 0;
    } else {
      map.set(row.id, {
        score: add,
        vecSim: 0,
        kwRank: Number(row.rank) || 0,
        chunk: row,
      });
    }
  });

  return [...map.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// Confidence used by the gate = max vector cosine similarity across the
// top-K. Falls back to 0 if no vector hit (purely keyword).
export function topConfidence(results) {
  if (!results.length) return 0;
  return Math.max(...results.map((r) => r.vecSim || 0));
}
