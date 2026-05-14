-- ─── M5: Auto follow-up engine ────────────────────────────────────────
-- Operator-defined rules + per-fire log.

-- CreateTable
CREATE TABLE "followup_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "pipeline_id" TEXT,
    "stage_id" TEXT,
    "hours_since_last_inbound" INTEGER NOT NULL,
    "template_name" TEXT NOT NULL,
    "max_reminders" INTEGER NOT NULL DEFAULT 1,
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "followup_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "followup_logs" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "message_id" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "followup_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "followup_rules_tenant_id_is_active_idx" ON "followup_rules"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "followup_logs_rule_id_lead_id_idx" ON "followup_logs"("rule_id", "lead_id");

-- CreateIndex
CREATE INDEX "followup_logs_lead_id_idx" ON "followup_logs"("lead_id");

-- CreateIndex
CREATE INDEX "followup_logs_sent_at_idx" ON "followup_logs"("sent_at");

-- AddForeignKey
ALTER TABLE "followup_rules" ADD CONSTRAINT "followup_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_rules" ADD CONSTRAINT "followup_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_logs" ADD CONSTRAINT "followup_logs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "followup_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_logs" ADD CONSTRAINT "followup_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_logs" ADD CONSTRAINT "followup_logs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
