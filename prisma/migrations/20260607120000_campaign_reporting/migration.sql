-- Campaign reporting: flight window, per-booking publisher anchor + live dates,
-- richer BookingMetrics, MetricsRequest + join.

-- Enums ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "MetricsRequestStatus" AS ENUM
    ('NEEDS_CONTACT','PENDING','PARTIAL','COMPLETE','EXPIRED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- MetricsSource: add the new members, migrate old PUBLISHER -> PUBLISHER_FORM.
ALTER TYPE "MetricsSource" ADD VALUE IF NOT EXISTS 'PUBLISHER_FORM';
ALTER TYPE "MetricsSource" ADD VALUE IF NOT EXISTS 'PUBLISHER_EMAIL';
-- (DESK already exists; PUBLISHER stays as a now-unused legacy value — Postgres
--  cannot drop an enum value. Existing rows are migrated below.)

-- Order ---------------------------------------------------------------------
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "flightStartDate" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "flightEndDate"   TIMESTAMP(3);

-- Backfill flight window from the linked Plan where present.
UPDATE "Order" o SET "flightStartDate" = p."startDate", "flightEndDate" = p."endDate"
FROM "Quote" q JOIN "Request" r ON r.id = q."requestId" JOIN "Plan" p ON p.id = r."planId"
WHERE q.id = o."quoteId" AND o."flightEndDate" IS NULL;

CREATE INDEX IF NOT EXISTS "Order_flightEndDate_idx" ON "Order"("flightEndDate");

-- PublisherBooking ----------------------------------------------------------
ALTER TABLE "PublisherBooking" ADD COLUMN IF NOT EXISTS "publisherId" TEXT;
ALTER TABLE "PublisherBooking" ADD COLUMN IF NOT EXISTS "titleId" TEXT;
ALTER TABLE "PublisherBooking" ADD COLUMN IF NOT EXISTS "liveStartDate" TIMESTAMP(3);
ALTER TABLE "PublisherBooking" ADD COLUMN IF NOT EXISTS "liveEndDate" TIMESTAMP(3);
ALTER TABLE "PublisherBooking" ADD COLUMN IF NOT EXISTS "publisherTrackingUrl" TEXT;

-- Backfill publisherId/titleId via orderLine -> product -> title -> publisher.
UPDATE "PublisherBooking" b
SET "titleId" = t.id, "publisherId" = t."publisherId"
FROM "OrderLine" ol JOIN "Product" pr ON pr.id = ol."productId" JOIN "Title" t ON t.id = pr."titleId"
WHERE ol.id = b."orderLineId" AND b."publisherId" IS NULL;

DO $$ BEGIN
  ALTER TABLE "PublisherBooking" ADD CONSTRAINT "PublisherBooking_publisherId_fkey"
    FOREIGN KEY ("publisherId") REFERENCES "Publisher"(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "PublisherBooking" ADD CONSTRAINT "PublisherBooking_titleId_fkey"
    FOREIGN KEY ("titleId") REFERENCES "Title"(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "PublisherBooking_publisherId_idx" ON "PublisherBooking"("publisherId");
CREATE INDEX IF NOT EXISTS "PublisherBooking_titleId_idx" ON "PublisherBooking"("titleId");

-- BookingMetrics ------------------------------------------------------------
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "pageViews" INTEGER;
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "publisherReportedClicks" INTEGER;
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "avgTimeSec" INTEGER;
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "scrollDepthPct" INTEGER;
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "extra" JSONB;
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "windowStart" TIMESTAMP(3);
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "windowEnd" TIMESTAMP(3);
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "frozenAt" TIMESTAMP(3);
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "impressionsAtClose" INTEGER;
ALTER TABLE "BookingMetrics" ADD COLUMN IF NOT EXISTS "clicksFirstPartyAtClose" INTEGER;

-- MetricsRequest + join -----------------------------------------------------
CREATE TABLE IF NOT EXISTS "MetricsRequest" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "publisherId" TEXT NOT NULL,
  "recipientEmail" TEXT,
  "recipientName" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "token" TEXT NOT NULL,
  "status" "MetricsRequestStatus" NOT NULL DEFAULT 'PENDING',
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "lastStepAt" TIMESTAMP(3),
  "nextStepAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetricsRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MetricsRequest_token_key" ON "MetricsRequest"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "MetricsRequest_orderId_publisherId_key" ON "MetricsRequest"("orderId","publisherId");
CREATE INDEX IF NOT EXISTS "MetricsRequest_orderId_idx" ON "MetricsRequest"("orderId");
CREATE INDEX IF NOT EXISTS "MetricsRequest_nextStepAt_respondedAt_cancelledAt_idx" ON "MetricsRequest"("nextStepAt","respondedAt","cancelledAt");
CREATE INDEX IF NOT EXISTS "MetricsRequest_status_idx" ON "MetricsRequest"("status");
DO $$ BEGIN
  ALTER TABLE "MetricsRequest" ADD CONSTRAINT "MetricsRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "MetricsRequest" ADD CONSTRAINT "MetricsRequest_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "MetricsRequest" ADD CONSTRAINT "MetricsRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "MetricsRequestBooking" (
  "metricsRequestId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  CONSTRAINT "MetricsRequestBooking_pkey" PRIMARY KEY ("metricsRequestId","bookingId")
);
CREATE INDEX IF NOT EXISTS "MetricsRequestBooking_bookingId_idx" ON "MetricsRequestBooking"("bookingId");
DO $$ BEGIN
  ALTER TABLE "MetricsRequestBooking" ADD CONSTRAINT "MetricsRequestBooking_metricsRequestId_fkey" FOREIGN KEY ("metricsRequestId") REFERENCES "MetricsRequest"(id) ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "MetricsRequestBooking" ADD CONSTRAINT "MetricsRequestBooking_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "PublisherBooking"(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
