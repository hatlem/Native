-- Rate-card ingestion: durable PDF storage + OCR + structured capture.
-- Additive and idempotent (prisma migrate dev is blocked; this is
-- hand-authored). Adds RateCardDocument (raw storage + history), the
-- PriceUnit / OwnContent enums, PriceQuote.priceUnit + rateCardDocumentId
-- (source attribution), and Title commercial-profile columns. All FK
-- back-links from a document are nullable with ON DELETE SET NULL so
-- deleting a title/publisher/contact-log never cascades away the record.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PriceUnit" AS ENUM ('FLAT', 'CPC', 'CPM');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OwnContent" AS ENUM ('YES', 'NO', 'WITH_APPROVAL', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "RateCardDocument" (
  "id" TEXT NOT NULL,
  "titleId" TEXT,
  "publisherId" TEXT,
  "contactLogId" TEXT,
  "fileName" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "contentType" TEXT NOT NULL DEFAULT 'application/pdf',
  "sizeBytes" INTEGER,
  "ocrText" TEXT,
  "ocrStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "source" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RateCardDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RateCardDocument_titleId_idx" ON "RateCardDocument"("titleId");
CREATE INDEX IF NOT EXISTS "RateCardDocument_publisherId_idx" ON "RateCardDocument"("publisherId");
CREATE INDEX IF NOT EXISTS "RateCardDocument_contactLogId_idx" ON "RateCardDocument"("contactLogId");

-- AlterTable: PriceQuote — pricing semantics + source-document link
ALTER TABLE "PriceQuote" ADD COLUMN IF NOT EXISTS "priceUnit" "PriceUnit" NOT NULL DEFAULT 'FLAT';
ALTER TABLE "PriceQuote" ADD COLUMN IF NOT EXISTS "rateCardDocumentId" TEXT;
CREATE INDEX IF NOT EXISTS "PriceQuote_rateCardDocumentId_idx" ON "PriceQuote"("rateCardDocumentId");

-- AlterTable: Title — commercial profile (rate-card ingestion)
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "ownContentAllowed" "OwnContent" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "contentPolicy" TEXT;
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "commercialExtra" JSONB;

-- Foreign keys (guarded for idempotency)
DO $$ BEGIN
  ALTER TABLE "RateCardDocument"
    ADD CONSTRAINT "RateCardDocument_titleId_fkey" FOREIGN KEY ("titleId")
    REFERENCES "Title"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "RateCardDocument"
    ADD CONSTRAINT "RateCardDocument_publisherId_fkey" FOREIGN KEY ("publisherId")
    REFERENCES "Publisher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "RateCardDocument"
    ADD CONSTRAINT "RateCardDocument_contactLogId_fkey" FOREIGN KEY ("contactLogId")
    REFERENCES "ContactLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "PriceQuote"
    ADD CONSTRAINT "PriceQuote_rateCardDocumentId_fkey" FOREIGN KEY ("rateCardDocumentId")
    REFERENCES "RateCardDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
