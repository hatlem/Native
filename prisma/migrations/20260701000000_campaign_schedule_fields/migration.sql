-- Campaign flow: per-product booking unit + minimum run, and per-shortlist-item schedule.

-- CreateEnum
CREATE TYPE "BookingUnit" AS ENUM ('WEEK', 'MONTH');

-- AlterTable: Product gains a booking granularity and optional minimum run.
ALTER TABLE "Product" ADD COLUMN "bookingUnit" "BookingUnit" NOT NULL DEFAULT 'MONTH';
ALTER TABLE "Product" ADD COLUMN "minDurationUnits" INTEGER;

-- AlterTable: SavedListItem records the chosen schedule (first period + unit count).
ALTER TABLE "SavedListItem" ADD COLUMN "scheduleStart" TIMESTAMP(3);
ALTER TABLE "SavedListItem" ADD COLUMN "scheduleUnits" INTEGER;
