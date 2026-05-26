ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'CONTEXTUAL';
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'OTHER';

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "confirmedSource" TEXT;

-- Honest-from-day-one backfill: all existing products are unconfirmed.
-- This intentionally hides all live prices until admin re-confirms via
-- the new pricing-request workflow.
UPDATE "Product" SET "confirmedAt" = NULL, "confirmedSource" = NULL;
