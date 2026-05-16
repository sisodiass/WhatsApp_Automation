-- Persistent capture of WhatsApp push-name (notifyName) on every
-- inbound. Nullable since most non-WA channels won't populate it.

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "notify_name" TEXT;
