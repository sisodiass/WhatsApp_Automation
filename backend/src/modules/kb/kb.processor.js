// BullMQ job handler for `pdf-processing` jobs. Runs in the worker process.
//
// Pipeline: read file → pdf-parse → chunk → embed (batched) → persist to
// kb_chunks (with the pgvector embedding written via raw SQL since Prisma
// can't write Unsupported types directly).

import fs from "node:fs/promises";
import pdfParse from "pdf-parse";

import { prisma } from "../../shared/prisma.js";
import { child } from "../../shared/logger.js";
import { chunkText } from "./chunker.js";
import { embedBatch, getActiveEmbeddingStamp, toVectorLiteral } from "./embeddings.js";
import { setDocumentStatus } from "./kb.service.js";

const log = child("kb-processor");
const EMBED_BATCH = 64;

export async function processPdfJob(job) {
  const { documentId } = job.data;
  log.info("processing pdf", { documentId, attempt: job.attemptsMade + 1 });

  const doc = await prisma.kbDocument.findUnique({ where: { id: documentId } });
  if (!doc) {
    log.warn("document not found, skipping", { documentId });
    return { skipped: "not_found" };
  }

  await setDocumentStatus(documentId, "PROCESSING");

  try {
    // 1. Extract text.
    const buffer = await fs.readFile(doc.filePath);
    const parsed = await pdfParse(buffer);
    const text = (parsed.text || "").trim();
    if (!text) throw new Error("PDF has no extractable text (scanned image?)");

    // 2. Chunk.
    const chunks = chunkText(text);
    if (!chunks.length) throw new Error("chunker produced 0 chunks");
    log.info("chunked", { documentId, chunks: chunks.length, chars: text.length });

    // 3. Embed in batches. Provider name + exact embedding model are
    //    stamped on each chunk so retrieval can filter to vectors that
    //    were produced under the current configuration only.
    const stamp = await getActiveEmbeddingStamp();
    const vectors = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const slice = chunks.slice(i, i + EMBED_BATCH);
      const vecs = await embedBatch(slice);
      vectors.push(...vecs);
    }

    // 4. Persist. Idempotent: clear any chunks from a prior failed attempt
    //    for this document, then re-insert.
    await prisma.kbChunk.deleteMany({ where: { documentId } });

    for (let i = 0; i < chunks.length; i++) {
      // Two-step: Prisma create gets us a cuid id + relational defaults,
      // then a raw UPDATE sets the embedding (Prisma can't set vector cols).
      const created = await prisma.kbChunk.create({
        data: {
          documentId,
          chunkIndex: i,
          text: chunks[i],
          embeddingProvider: stamp.name,
          embeddingModel: stamp.model,
        },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE kb_chunks SET embedding = $1::vector WHERE id = $2`,
        toVectorLiteral(vectors[i]),
        created.id,
      );
    }

    await setDocumentStatus(documentId, "READY");
    log.info("pdf ready", { documentId, chunks: chunks.length });
    return { chunks: chunks.length };
  } catch (err) {
    log.error("pdf processing failed", { documentId, err: err.message });
    await setDocumentStatus(documentId, "FAILED", err.message).catch(() => {});
    throw err; // BullMQ will retry up to attempts
  }
}
