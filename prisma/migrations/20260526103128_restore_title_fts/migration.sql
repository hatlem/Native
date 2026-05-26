-- Restore the Postgres FTS column + GIN index that an earlier WIP commit
-- removed from schema.prisma. The runtime code (src/lib/catalog-search.ts)
-- still queries this column via $queryRaw; without it, catalog search
-- throws "column searchTsv does not exist" at runtime.
--
-- The column is a STORED generated tsvector — Prisma cannot model this
-- natively, so it's intentionally kept out of schema.prisma and managed
-- here. Prisma will report this as drift on future `migrate dev` runs;
-- that's expected. Treat the drift as benign for this column only.

ALTER TABLE "Title"
  ADD COLUMN "searchTsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("category", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("audienceNote", '')), 'C')
  ) STORED;

CREATE INDEX "Title_searchTsv_idx" ON "Title" USING GIN ("searchTsv");
