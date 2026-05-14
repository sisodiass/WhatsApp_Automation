-- ─── M6: Workflow Automation ─────────────────────────────────────────
-- JSON-defined automations triggered by domain events, executed step
-- by step via the automation-runs BullMQ queue.

-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('NEW_LEAD', 'STAGE_CHANGED', 'LEAD_ASSIGNED', 'NO_REPLY', 'TAG_ADDED', 'CAMPAIGN_REPLIED', 'INBOUND_KEYWORD');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "trigger" "AutomationTrigger" NOT NULL,
    "trigger_config" JSONB,
    "definition" JSONB NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "chat_id" TEXT,
    "contact_id" TEXT,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'PENDING',
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "context" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automations_tenant_id_is_active_idx" ON "automations"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "automations_tenant_id_trigger_idx" ON "automations"("tenant_id", "trigger");

-- CreateIndex
CREATE INDEX "automation_runs_automation_id_status_idx" ON "automation_runs"("automation_id", "status");

-- CreateIndex
CREATE INDEX "automation_runs_lead_id_idx" ON "automation_runs"("lead_id");

-- CreateIndex
CREATE INDEX "automation_runs_status_idx" ON "automation_runs"("status");

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
