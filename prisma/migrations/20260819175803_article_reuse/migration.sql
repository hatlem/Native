-- CreateTable
CREATE TABLE "ArticlePlacement" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "lockedAssetId" TEXT,
    "specPassed" BOOLEAN,
    "specNotes" TEXT,
    "retractedAt" TIMESTAMP(3),
    "retractedBy" TEXT,
    "retractionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticlePlacement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArticlePlacement_orderLineId_key" ON "ArticlePlacement"("orderLineId");
CREATE INDEX "ArticlePlacement_articleId_idx" ON "ArticlePlacement"("articleId");

ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArticlePlacement" ADD CONSTRAINT "ArticlePlacement_lockedAssetId_fkey" FOREIGN KEY ("lockedAssetId") REFERENCES "ContentAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: SavedList gets articleId (additive), articleAngle retired.
ALTER TABLE "SavedList" ADD COLUMN "articleId" TEXT;
ALTER TABLE "SavedList" ADD CONSTRAINT "SavedList_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SavedList" DROP COLUMN "articleAngle";

-- Backfill: one ArticlePlacement per existing 1:1 Article.orderLineId link,
-- carrying over the (about-to-be-dropped) per-asset spec/retraction fields
-- from that article's latest ContentAsset version, and locking to that
-- version if its status was already FINAL. LEFT JOIN LATERAL (not an inner
-- join): a staffed-but-undrafted line has a linked Article with zero
-- ContentAsset rows (no draft submitted yet — a normal, currently-live
-- production state), and that Article must still get a placement row with
-- every asset-derived column NULL, not be silently dropped.
INSERT INTO "ArticlePlacement" ("id", "orderLineId", "articleId", "lockedAssetId", "specPassed", "specNotes", "retractedAt", "retractedBy", "retractionNote", "createdAt", "updatedAt")
SELECT
  'plc_' || a.id,
  a."orderLineId",
  a.id,
  CASE WHEN latest.status = 'FINAL' THEN latest.id ELSE NULL END,
  latest."specPassed",
  latest."reviewNotes",
  latest."retractedAt",
  latest."retractedBy",
  latest."retractionNote",
  a."createdAt",
  a."updatedAt"
FROM "Article" a
LEFT JOIN LATERAL (
  SELECT ca.id, ca.status, ca."specPassed", ca."reviewNotes", ca."retractedAt", ca."retractedBy", ca."retractionNote"
  FROM "ContentAsset" ca
  WHERE ca."articleId" = a.id
  ORDER BY ca.version DESC, ca."createdAt" DESC, ca.id DESC
  LIMIT 1
) latest ON true
WHERE a."orderLineId" IS NOT NULL;

-- Guard: every Article with a non-null orderLineId must have produced
-- exactly one ArticlePlacement row. This is the last point at which the
-- invariant is checkable — Article.orderLineId is dropped right after —
-- so a regression here must abort the migration loudly rather than
-- silently destroy the only record of the link.
DO $$
DECLARE expected INT; actual INT;
BEGIN
  SELECT count(*) INTO expected FROM "Article" WHERE "orderLineId" IS NOT NULL;
  SELECT count(*) INTO actual FROM "ArticlePlacement";
  IF expected <> actual THEN
    RAISE EXCEPTION 'ArticlePlacement backfill lost rows: % links, % placements', expected, actual;
  END IF;
END $$;

-- Now that the backfill has read them, drop the fields ArticlePlacement replaces.
ALTER TABLE "ContentAsset" DROP COLUMN "specPassed";
ALTER TABLE "ContentAsset" DROP COLUMN "retractedAt";
ALTER TABLE "ContentAsset" DROP COLUMN "retractedBy";
ALTER TABLE "ContentAsset" DROP COLUMN "retractionNote";

-- Drop the old 1:1 FK/index on Article.
ALTER TABLE "Article" DROP CONSTRAINT "Article_orderLineId_fkey";
DROP INDEX "Article_orderLineId_key";
ALTER TABLE "Article" DROP COLUMN "orderLineId";

-- RETRACTED has been a live enum value since migration
-- 20260526210000_order_cancellation_and_editorial_veto (merged to main,
-- deployed to prod) — the publisher-side rejectAsset flow sets it, so
-- production ContentAsset rows can genuinely hold status='RETRACTED' today.
-- The retraction facts (retractedAt/retractedBy/retractionNote) have
-- already been carried into ArticlePlacement by the backfill above; the
-- status value itself has no home once RETRACTED is removed from the enum,
-- so remap any such rows to CHANGES_REQUESTED (closest surviving status —
-- "not currently presentable, needs rework") before the type swap below.
UPDATE "ContentAsset" SET "status" = 'CHANGES_REQUESTED' WHERE "status" = 'RETRACTED';

-- Remove RETRACTED from ContentAssetStatus. Postgres can't drop an enum
-- value directly: build the replacement type, swap the column over, drop
-- the old type.
CREATE TYPE "ContentAssetStatus_new" AS ENUM ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'FINAL');
ALTER TABLE "ContentAsset" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ContentAsset" ALTER COLUMN "status" TYPE "ContentAssetStatus_new" USING ("status"::text::"ContentAssetStatus_new");
ALTER TABLE "ContentAsset" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "ContentAssetStatus";
ALTER TYPE "ContentAssetStatus_new" RENAME TO "ContentAssetStatus";
