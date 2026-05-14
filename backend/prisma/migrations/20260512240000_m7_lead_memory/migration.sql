-- ─── M7: AI Lead Memory ──────────────────────────────────────────────
-- Per-lead schemaless memory store. One row per lead. Read + updated by
-- the scoring + suggested-replies pipeline.

-- CreateTable
CREATE TABLE "lead_memory" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "memory" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_memory_lead_id_key" ON "lead_memory"("lead_id");

-- AddForeignKey
ALTER TABLE "lead_memory" ADD CONSTRAINT "lead_memory_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
