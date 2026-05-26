-- Per-Publisher and per-Title price-visibility switch. Default TRUE
-- preserves current behavior (every existing title remains visible).
-- Effective visibility for the buyer = publisher.pricesPublic AND
-- title.pricesPublic. When false, the catalog / recommender / public
-- API hide all € figures for the title and surface "Request price"
-- instead. The desk still sees and quotes from internal prices.

ALTER TABLE "Publisher"
  ADD COLUMN IF NOT EXISTS "pricesPublic" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "Title"
  ADD COLUMN IF NOT EXISTS "pricesPublic" BOOLEAN NOT NULL DEFAULT TRUE;
