-- Title geo enrichment + Plan structured targeting brief. All additive,
-- all nullable; no enum changes, safe to run as one transaction.

-- AlterTable: Title
ALTER TABLE "Title"
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "region" TEXT;

-- AlterTable: Plan
ALTER TABLE "Plan"
  ADD COLUMN IF NOT EXISTS "targetGeo" TEXT,
  ADD COLUMN IF NOT EXISTS "targetAudience" TEXT,
  ADD COLUMN IF NOT EXISTS "targetContext" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Title_city_idx" ON "Title"("city");
CREATE INDEX IF NOT EXISTS "Title_region_idx" ON "Title"("region");
