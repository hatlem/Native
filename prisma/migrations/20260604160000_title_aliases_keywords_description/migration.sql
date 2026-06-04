-- Alias matching (dedup), curated search tags, and a human description per
-- title — enrichment captured as we learn more from publisher replies.
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "description" TEXT;
