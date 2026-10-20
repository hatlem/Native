-- Typo-tolerant catalog search (catalog-search.ts searchFuzzyTitleIds): a
-- trigram index on the title name serves `word <% name` lookups.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Title_name_trgm_idx" ON "Title" USING GIN ("name" gin_trgm_ops);
