-- ─── M9: Channels + UTM tracking ─────────────────────────────────────
-- Adds the Channel model + chats.channel_id + Lead.utm_* attribution
-- columns. Default WhatsApp + Web Chat channels are seeded by the seed
-- script; existing chats are backfilled to the WhatsApp channel by the
-- accompanying data migration in prisma/backfill-channels.js.

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'FB_MESSENGER', 'WEB_CHAT');

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channels_tenant_id_type_key" ON "channels"("tenant_id", "type");

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable chats: add channel_id (nullable)
ALTER TABLE "chats" ADD COLUMN "channel_id" TEXT;

-- CreateIndex
CREATE INDEX "chats_channel_id_idx" ON "chats"("channel_id");

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable leads: add UTM attribution columns (all nullable)
ALTER TABLE "leads" ADD COLUMN "utm_source" TEXT;
ALTER TABLE "leads" ADD COLUMN "utm_medium" TEXT;
ALTER TABLE "leads" ADD COLUMN "utm_campaign" TEXT;
ALTER TABLE "leads" ADD COLUMN "ad_id" TEXT;
ALTER TABLE "leads" ADD COLUMN "landing_page" TEXT;
ALTER TABLE "leads" ADD COLUMN "referrer" TEXT;
