-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'AGENT', 'VIEWER');

-- CreateEnum
CREATE TYPE "ConversationState" AS ENUM ('NEW', 'ACTIVE', 'PAUSED', 'DEMO_PENDING', 'FOLLOWUP', 'MANUAL', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChatMode" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('CUSTOMER', 'AI', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "SessionEndReason" AS ENUM ('CAMPAIGN_REENTRY', 'ADMIN_CLOSED', 'MANUAL_RESET');

-- CreateEnum
CREATE TYPE "ManualReason" AS ENUM ('AI_REPLY_LIMIT', 'LOW_CONFIDENCE', 'KEYWORD_TRIGGER', 'ADMIN_FORCED', 'GLOBAL_AI_OFF', 'NEGATIVE_SENTIMENT');

-- CreateEnum
CREATE TYPE "TemplateType" AS ENUM ('ONBOARDING_DEFAULT', 'MANUAL_HANDOFF', 'FALLBACK', 'SESSION_RESUME', 'DEMO_CONFIRMATION');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'AGENT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "onboarding_message" TEXT NOT NULL,
    "form_link" TEXT,
    "business_type" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_kb_groups" (
    "campaign_id" TEXT NOT NULL,
    "kb_group_id" TEXT NOT NULL,

    CONSTRAINT "campaign_kb_groups_pkey" PRIMARY KEY ("campaign_id","kb_group_id")
);

-- CreateTable
CREATE TABLE "kb_groups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "confidence_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.82,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_documents" (
    "id" TEXT NOT NULL,
    "kb_group_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "uploaded_by_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" vector(1536),
    "embedding_provider" TEXT,
    "embedding_model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chats" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "display_name" TEXT,
    "current_session_id" TEXT,
    "processing_lock_until" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "state" "ConversationState" NOT NULL DEFAULT 'NEW',
    "mode" "ChatMode" NOT NULL DEFAULT 'AI',
    "ai_reply_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_confidence" DOUBLE PRECISION,
    "last_ai_reply_at" TIMESTAMP(3),
    "ai_provider" TEXT,
    "ended_at" TIMESTAMP(3),
    "ended_reason" "SessionEndReason",

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "source" "MessageSource" NOT NULL,
    "body" TEXT NOT NULL,
    "kb_chunk_ids" TEXT[],
    "confidence" DOUBLE PRECISION,
    "wa_message_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_tags" (
    "chat_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "chat_tags_pkey" PRIMARY KEY ("chat_id","tag_id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "author_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings_audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "changed_by_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TemplateType" NOT NULL,
    "content" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_queue_items" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "reason" "ManualReason" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_by_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "manual_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_bookings" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "teams_meeting_id" TEXT,
    "teams_join_url" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_tag_key" ON "campaigns"("tag");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_idx" ON "campaigns"("tenant_id");

-- CreateIndex
CREATE INDEX "campaigns_is_active_idx" ON "campaigns"("is_active");

-- CreateIndex
CREATE INDEX "kb_groups_tenant_id_idx" ON "kb_groups"("tenant_id");

-- CreateIndex
CREATE INDEX "kb_documents_kb_group_id_is_active_idx" ON "kb_documents"("kb_group_id", "is_active");

-- CreateIndex
CREATE INDEX "kb_chunks_document_id_idx" ON "kb_chunks"("document_id");

-- CreateIndex
CREATE INDEX "kb_chunks_embedding_provider_embedding_model_idx" ON "kb_chunks"("embedding_provider", "embedding_model");

-- CreateIndex
CREATE INDEX "chats_last_message_at_idx" ON "chats"("last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "chats_tenant_id_phone_key" ON "chats"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "chat_sessions_chat_id_ended_at_idx" ON "chat_sessions"("chat_id", "ended_at");

-- CreateIndex
CREATE INDEX "chat_sessions_campaign_id_idx" ON "chat_sessions"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_wa_message_id_key" ON "messages"("wa_message_id");

-- CreateIndex
CREATE INDEX "messages_session_id_created_at_idx" ON "messages"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tenant_id_name_key" ON "tags"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "notes_chat_id_idx" ON "notes"("chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "settings_tenant_id_key_key" ON "settings"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "settings_audit_logs_tenant_id_key_idx" ON "settings_audit_logs"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "settings_audit_logs_changed_at_idx" ON "settings_audit_logs"("changed_at");

-- CreateIndex
CREATE INDEX "message_templates_tenant_id_type_idx" ON "message_templates"("tenant_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_tenant_id_name_key" ON "message_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "manual_queue_items_resolved_at_idx" ON "manual_queue_items"("resolved_at");

-- CreateIndex
CREATE INDEX "manual_queue_items_chat_id_idx" ON "manual_queue_items"("chat_id");

-- CreateIndex
CREATE INDEX "demo_bookings_chat_id_idx" ON "demo_bookings"("chat_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_kb_groups" ADD CONSTRAINT "campaign_kb_groups_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_kb_groups" ADD CONSTRAINT "campaign_kb_groups_kb_group_id_fkey" FOREIGN KEY ("kb_group_id") REFERENCES "kb_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_groups" ADD CONSTRAINT "kb_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_kb_group_id_fkey" FOREIGN KEY ("kb_group_id") REFERENCES "kb_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "kb_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_tags" ADD CONSTRAINT "chat_tags_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_tags" ADD CONSTRAINT "chat_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings_audit_logs" ADD CONSTRAINT "settings_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings_audit_logs" ADD CONSTRAINT "settings_audit_logs_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_queue_items" ADD CONSTRAINT "manual_queue_items_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_queue_items" ADD CONSTRAINT "manual_queue_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_queue_items" ADD CONSTRAINT "manual_queue_items_claimed_by_id_fkey" FOREIGN KEY ("claimed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_bookings" ADD CONSTRAINT "demo_bookings_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
