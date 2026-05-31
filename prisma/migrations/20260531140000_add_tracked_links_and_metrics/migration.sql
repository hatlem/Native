-- In-article tracked links + optional booking impressions. All additive.

-- CreateEnum
CREATE TYPE "MetricsSource" AS ENUM ('PUBLISHER', 'DESK');

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "label" TEXT,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingMetrics" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "impressions" INTEGER,
    "source" "MetricsSource" NOT NULL DEFAULT 'PUBLISHER',
    "note" TEXT,
    "reportedAt" TIMESTAMP(3),
    "reportedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BookingMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_token_key" ON "TrackedLink"("token");
CREATE INDEX "TrackedLink_orderLineId_idx" ON "TrackedLink"("orderLineId");
CREATE UNIQUE INDEX "BookingMetrics_bookingId_key" ON "BookingMetrics"("bookingId");

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingMetrics" ADD CONSTRAINT "BookingMetrics_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "PublisherBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
