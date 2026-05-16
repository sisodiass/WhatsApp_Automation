-- M11.C3b — webhook event dedup. Stripe is at-least-once; the unique
-- constraint on provider_event_id short-circuits retries so side
-- effects fire exactly once.

CREATE TABLE "billing_webhook_events" (
    "id" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tenant_id" TEXT,
    "raw_payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_webhook_events_provider_event_id_key" ON "billing_webhook_events"("provider_event_id");
CREATE INDEX "billing_webhook_events_provider_type_idx" ON "billing_webhook_events"("provider", "type");
CREATE INDEX "billing_webhook_events_tenant_id_idx" ON "billing_webhook_events"("tenant_id");
