-- ─── M4: Bulk Campaigns ──────────────────────────────────────────────
-- Adds BulkCampaign + BulkCampaignRecipient with approval-flow status,
-- safety controls (quiet hours, daily caps, jitter, skip recent
-- responders), and denormalized analytics counters.

-- CreateEnum
CREATE TYPE "BulkCampaignStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BulkRecipientStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'REPLIED');

-- CreateTable
CREATE TABLE "bulk_campaigns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message_body" TEXT NOT NULL,
    "media_url" TEXT,
    "media_type" TEXT,
    "status" "BulkCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "daily_limit" INTEGER NOT NULL DEFAULT 500,
    "delay_min" INTEGER NOT NULL DEFAULT 30,
    "delay_max" INTEGER NOT NULL DEFAULT 60,
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "skip_replied_hours" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "read_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "replied_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulk_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_campaign_recipients" (
    "id" TEXT NOT NULL,
    "bulk_campaign_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "message_id" TEXT,
    "status" "BulkRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "planned_at" TIMESTAMP(3),
    "queued_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bulk_campaigns_tenant_id_status_idx" ON "bulk_campaigns"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "bulk_campaigns_tenant_id_scheduled_at_idx" ON "bulk_campaigns"("tenant_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "bulk_campaigns_tenant_id_created_at_idx" ON "bulk_campaigns"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_campaign_recipients_bulk_campaign_id_contact_id_key" ON "bulk_campaign_recipients"("bulk_campaign_id", "contact_id");

-- CreateIndex
CREATE INDEX "bulk_campaign_recipients_bulk_campaign_id_status_idx" ON "bulk_campaign_recipients"("bulk_campaign_id", "status");

-- CreateIndex
CREATE INDEX "bulk_campaign_recipients_message_id_idx" ON "bulk_campaign_recipients"("message_id");

-- CreateIndex
CREATE INDEX "bulk_campaign_recipients_status_planned_at_idx" ON "bulk_campaign_recipients"("status", "planned_at");

-- AddForeignKey
ALTER TABLE "bulk_campaigns" ADD CONSTRAINT "bulk_campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_campaigns" ADD CONSTRAINT "bulk_campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_campaigns" ADD CONSTRAINT "bulk_campaigns_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_campaign_recipients" ADD CONSTRAINT "bulk_campaign_recipients_bulk_campaign_id_fkey" FOREIGN KEY ("bulk_campaign_id") REFERENCES "bulk_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_campaign_recipients" ADD CONSTRAINT "bulk_campaign_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_campaign_recipients" ADD CONSTRAINT "bulk_campaign_recipients_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
