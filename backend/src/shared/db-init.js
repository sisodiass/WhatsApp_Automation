// Idempotent runtime DB extras that Prisma's DSL can't express:
//   1. Generated tsvector column on kb_chunks for keyword/BM25-lite search
//   2. GIN index on the tsvector
//   3. HNSW index on the embedding vector for fast cosine similarity
//
// Runs at API boot AFTER `prisma migrate dev` has applied the base schema.
// Each statement uses IF NOT EXISTS so reboots are no-ops.

import { prisma } from "./prisma.js";
import { child } from "./logger.js";

const log = child("db-init");

const STATEMENTS = [
  {
    label: "kb_chunks.text_tsv generated column",
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'kb_chunks' AND column_name = 'text_tsv'
        ) THEN
          ALTER TABLE kb_chunks
            ADD COLUMN text_tsv tsvector
            GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED;
        END IF;
      END
      $$;
    `,
  },
  {
    label: "kb_chunks_tsv_idx (GIN)",
    sql: `CREATE INDEX IF NOT EXISTS kb_chunks_tsv_idx
            ON kb_chunks USING gin(text_tsv)`,
  },
  {
    label: "kb_chunks_embedding_idx (HNSW cosine)",
    sql: `CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx
            ON kb_chunks USING hnsw (embedding vector_cosine_ops)`,
  },
];

export async function ensureKbIndexes() {
  for (const { label, sql } of STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      // Most common cause: kb_chunks doesn't exist yet because migrations
      // haven't been applied. Log once and move on — operator fixes it.
      log.warn(`db-init step skipped: ${label}`, { err: err.message });
    }
  }
  log.info("kb indexes ensured");
}
