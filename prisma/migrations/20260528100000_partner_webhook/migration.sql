-- CreateTable
CREATE TABLE "PartnerWebhook" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "events" TEXT NOT NULL DEFAULT 'title.activated,title.deactivated',
    "targetUrl" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorBody" TEXT,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "PartnerWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerWebhook_apiKeyId_idx" ON "PartnerWebhook"("apiKeyId");

-- CreateIndex
CREATE INDEX "PartnerWebhook_disabledAt_idx" ON "PartnerWebhook"("disabledAt");

-- AddForeignKey
ALTER TABLE "PartnerWebhook" ADD CONSTRAINT "PartnerWebhook_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
