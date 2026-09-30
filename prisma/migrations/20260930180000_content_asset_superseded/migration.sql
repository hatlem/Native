-- A content version that a newer version replaced before it was ever
-- approved (e.g. v1 still "in review" after v2 was submitted and
-- approved). Without a terminal state for it, the stale version kept
-- showing as pending review on the desk and in the buyer's review badge.
-- Additive: existing rows are untouched here (the backfill is its own
-- migration, since a new enum value can't be used in the transaction
-- that adds it).
ALTER TYPE "ContentAssetStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
