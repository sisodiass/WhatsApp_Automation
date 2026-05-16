-- M11.C1 — auth tokens for verify-email + reset-password flows.
-- Tokens are SHA-256 hashed at rest; the plaintext lives only in the
-- email body sent to the user.

-- CreateEnum
CREATE TYPE "AuthTokenKind" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "AuthTokenKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_kind_idx" ON "auth_tokens"("user_id", "kind");

-- CreateIndex
CREATE INDEX "auth_tokens_expires_at_idx" ON "auth_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
