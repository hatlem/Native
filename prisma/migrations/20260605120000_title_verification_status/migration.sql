-- Positive production-verification signal for titles.
DO $$ BEGIN
  CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'LIVE', 'DISCONTINUED', 'UNCERTAIN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "verificationSource" TEXT;

-- Backfill: anything already discontinued is, by definition, DISCONTINUED.
UPDATE "Title" SET "verificationStatus" = 'DISCONTINUED'
  WHERE "discontinuedAt" IS NOT NULL AND "verificationStatus" = 'UNVERIFIED';
