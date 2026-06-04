-- Core dimension: does a title offer advertiser content (annonsørinnhold/
-- native) at all — the whole point of the catalog is the overview of who
-- offers it. null = unknown, true = yes, false = explicitly no (display only).
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "offersNativeContent" BOOLEAN;
-- Recurring commercial metrics promoted out of commercialExtra into
-- structured, queryable columns (same data recurs across media kits).
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "facebookFollowers" INTEGER;
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "instagramFollowers" INTEGER;
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "agencyCommissionPct" DECIMAL(5,2);
