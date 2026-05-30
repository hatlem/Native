-- Publisher programmatic ingestion: bind keys to a publisher + idempotency refs.

-- AlterTable
ALTER TABLE "Title" ADD COLUMN "externalRef" TEXT;
ALTER TABLE "Product" ADD COLUMN "externalRef" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN "publisherId" TEXT;

-- CreateIndex (NULLs are distinct in Postgres, so many null externalRefs coexist)
CREATE UNIQUE INDEX "Title_publisherId_externalRef_key" ON "Title"("publisherId", "externalRef");
CREATE UNIQUE INDEX "Product_titleId_externalRef_key" ON "Product"("titleId", "externalRef");
CREATE INDEX "ApiKey_publisherId_idx" ON "ApiKey"("publisherId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
