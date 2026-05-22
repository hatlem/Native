-- Notification kinds + job statuses.
CREATE TYPE "NotificationKind" AS ENUM (
  'RFQ_SUBMITTED',
  'QUOTE_READY',
  'QUOTE_ACCEPTED',
  'BOOKING_NEW',
  'BOOKING_CONFIRMED',
  'ASSET_REVIEW',
  'INVOICE_ISSUED'
);

CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- Per-market disclosure default (PLAN §13).
ALTER TABLE "Market" ADD COLUMN "disclosureLabel" TEXT;

-- Phase-3 availability calendar.
CREATE TABLE "Availability" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "blocked" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Availability_productId_year_month_key"
  ON "Availability"("productId", "year", "month");
CREATE INDEX "Availability_productId_idx" ON "Availability"("productId");
ALTER TABLE "Availability"
  ADD CONSTRAINT "Availability_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Notification inbox.
CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "NotificationKind" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "link" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_readAt_idx"
  ON "Notification"("userId", "readAt");
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Async job queue.
CREATE TABLE "Job" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- Postgres full-text search on Title (PLAN §9). A computed tsvector
-- column kept in sync by a trigger so the catalog can query it with
-- @@. We index name/category/audienceNote — the fields users actually
-- search. Stored as `simple` to stay language-agnostic across NO/SE/DK/EN.
ALTER TABLE "Title"
  ADD COLUMN "searchTsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("category", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("audienceNote", '')), 'C')
  ) STORED;
CREATE INDEX "Title_searchTsv_idx" ON "Title" USING GIN ("searchTsv");

-- Backfill disclosure defaults for the seeded Nordic markets so the
-- per-market spec check has something to fall back to even before
-- catalog admins set their own labels.
UPDATE "Market" SET "disclosureLabel" = 'Annonsørinnhold' WHERE "code" = 'NO';
UPDATE "Market" SET "disclosureLabel" = 'Annons' WHERE "code" = 'SE';
UPDATE "Market" SET "disclosureLabel" = 'Annonce' WHERE "code" = 'DK';
