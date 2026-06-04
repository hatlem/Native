-- Extend the catalog FTS tsvector to include the curated search fields we
-- now capture: keywords + aliases (so a title is found by alias/brand name)
-- and description. searchTsv is a STORED generated column (managed outside
-- schema.prisma; see 20260526103128_restore_title_fts) — recreate it.
DROP INDEX IF EXISTS "Title_searchTsv_idx";
ALTER TABLE "Title" DROP COLUMN IF EXISTS "searchTsv";
ALTER TABLE "Title"
  ADD COLUMN "searchTsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('simple', array_to_string("aliases", ' ')), 'A') ||
    setweight(to_tsvector('simple', coalesce("category", '')), 'B') ||
    setweight(to_tsvector('simple', array_to_string("keywords", ' ')), 'B') ||
    setweight(to_tsvector('simple', coalesce("audienceNote", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'C')
  ) STORED;
CREATE INDEX "Title_searchTsv_idx" ON "Title" USING GIN ("searchTsv");
