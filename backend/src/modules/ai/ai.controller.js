import { asyncHandler } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { getSettings } from "../settings/settings.service.js";
import { getProvider, listProviders } from "./providers/index.js";

// GET /api/ai/status — current provider + KB coverage breakdown.
// Cheap (DB only); safe to call from the dashboard pill on a polite cadence.
export const status = asyncHandler(async (req, res) => {
  const tenantId = req.auth.tenantId;
  const cfg = await getSettings(tenantId, [
    "ai.provider",
    "ai.openai.chat_model",
    "ai.openai.embedding_model",
    "ai.gemini.chat_model",
    "ai.gemini.embedding_model",
  ]);

  const active = String(cfg["ai.provider"] || "openai").toLowerCase();
  const activeEmbedModel =
    active === "openai"
      ? cfg["ai.openai.embedding_model"] || null
      : cfg["ai.gemini.embedding_model"] || null;

  // Chunk counts grouped by (provider, model). The active row tells us
  // current-config coverage; everything else is stale and would be
  // ignored by retrieval until reprocessed.
  const breakdown = await prisma.$queryRawUnsafe(
    `SELECT embedding_provider AS provider,
            embedding_model    AS model,
            COUNT(*)::int      AS count
       FROM kb_chunks
      WHERE document_id IN (SELECT id FROM kb_documents WHERE is_active = true)
      GROUP BY embedding_provider, embedding_model
      ORDER BY count DESC`,
  );

  let matching = 0;
  let stale = 0;
  for (const row of breakdown) {
    if (row.provider === active && row.model === activeEmbedModel) matching += row.count;
    else stale += row.count;
  }

  // Documents needing re-embed = active docs whose chunks aren't all
  // stamped with the current (provider, model). Cheap upper bound.
  const docsTotal = await prisma.kbDocument.count({ where: { isActive: true } });
  const docsCoveredRows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(DISTINCT document_id)::int AS n
       FROM kb_chunks
      WHERE embedding_provider = $1
        AND embedding_model = $2
        AND document_id IN (SELECT id FROM kb_documents WHERE is_active = true)`,
    active,
    activeEmbedModel,
  );
  const docsCovered = docsCoveredRows[0]?.n ?? 0;
  const docsStale = Math.max(0, docsTotal - docsCovered);

  res.json({
    active,
    available: listProviders(),
    models: {
      openai: {
        chat: cfg["ai.openai.chat_model"] || null,
        embedding: cfg["ai.openai.embedding_model"] || null,
      },
      gemini: {
        chat: cfg["ai.gemini.chat_model"] || null,
        embedding: cfg["ai.gemini.embedding_model"] || null,
      },
    },
    coverage: {
      active_chunks: matching,
      stale_chunks: stale,
      total_chunks: matching + stale,
      docs_total: docsTotal,
      docs_covered: docsCovered,
      docs_stale: docsStale,
      needs_reembed: docsStale > 0,
    },
    chunks_by_stamp: breakdown,
  });
});

// GET /api/ai/health — runs the active provider's healthCheck (1 embed +
// 1 cheap chat call). Slow; do not poll on a schedule.
export const health = asyncHandler(async (req, res) => {
  const provider = await getProvider();
  const result = await provider.healthCheck();
  res.status(result.ok ? 200 : 503).json(result);
});
