-- Extend the catalog FTS tsvector to also index `vertical` (weight B) and
-- the legacy `tags` string (weight C). For the CSV-imported research
-- catalog, `vertical` is often the ONLY field carrying the domain
-- classification (e.g. "B2B – Transport & Logistics", "B2B – Maritime") —
-- name/aliases/category/keywords/audienceNote/description (the fields
-- 20260604170000_fts_keywords_description indexed) can all be silent for a
-- title whose vertical alone says what it covers. Buyers searching English
-- domain words like "transport & logistics" or "maritime" got zero hits
-- because of this gap.
--
-- searchTsv is a STORED generated column (managed outside schema.prisma;
-- see 20260526103128_restore_title_fts) — recreate it, same immutable-join
-- guard as 20260604170000_fts_keywords_description (array_to_string is not
-- IMMUTABLE, so generated-column expressions can't call it directly).
CREATE OR REPLACE FUNCTION immutable_text_array_join(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT array_to_string($1, ' ') $$;

DROP INDEX IF EXISTS "Title_searchTsv_idx";
ALTER TABLE "Title" DROP COLUMN IF EXISTS "searchTsv";
ALTER TABLE "Title"
  ADD COLUMN "searchTsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('simple', immutable_text_array_join("aliases")), 'A') ||
    setweight(to_tsvector('simple', coalesce("category", '')), 'B') ||
    setweight(to_tsvector('simple', immutable_text_array_join("keywords")), 'B') ||
    setweight(to_tsvector('simple', coalesce("vertical", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("audienceNote", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("tags", '')), 'C')
  ) STORED;
CREATE INDEX "Title_searchTsv_idx" ON "Title" USING GIN ("searchTsv");
