-- ─── Website Integrations (public API + embeddable widget) ─────────

-- CreateTable
CREATE TABLE "website_integrations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "widget_enabled" BOOLEAN NOT NULL DEFAULT true,
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60,
    "widget_config" JSONB,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "website_integrations_api_key_key" ON "website_integrations"("api_key");

-- CreateIndex
CREATE INDEX "website_integrations_tenant_id_is_active_idx" ON "website_integrations"("tenant_id", "is_active");

-- AddForeignKey
ALTER TABLE "website_integrations" ADD CONSTRAINT "website_integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
