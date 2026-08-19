-- Idempotency-Key support for POST /api/v1/orders. One row per
-- (apiKeyId, key): reserved "pending" before the order transaction and
-- completed with the stored response after, so a client-retried request
-- replays the first response instead of double-charging. Purely additive.

-- CreateTable
CREATE TABLE "ApiIdempotencyKey" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiIdempotencyKey_apiKeyId_key_key" ON "ApiIdempotencyKey"("apiKeyId", "key");

-- CreateIndex
CREATE INDEX "ApiIdempotencyKey_createdAt_idx" ON "ApiIdempotencyKey"("createdAt");

-- AddForeignKey
ALTER TABLE "ApiIdempotencyKey" ADD CONSTRAINT "ApiIdempotencyKey_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
