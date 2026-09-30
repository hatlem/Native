-- Review rounds for article versions. ContentAsset.version counts every save,
-- so the buyer's first review email said "Version 5" after a writer's five
-- saves. reviewRound numbers only the hand-overs to the client (1, 2, …) and
-- is what the buyer and every draft notice now show; see
-- src/lib/content/versions.ts nextReviewRound.
--
-- Existing rows are numbered from the recorded facts, not guessed: every
-- hand-over wrote an "asset.status" audit row with status IN_REVIEW (see
-- src/app/desk-content-actions.ts setAssetStatus). Per article, those rows in
-- time order are rounds 1, 2, …; a version sent back and resubmitted keeps its
-- latest round. A version with no such audit row stays NULL (never sent, or
-- sent before audits existed) and the UI falls back to not numbering it.
-- Stored notifications are left as they were.
--
-- Additive; revert with:
--   ALTER TABLE "ContentAsset" DROP COLUMN "reviewRound";
ALTER TABLE "ContentAsset" ADD COLUMN IF NOT EXISTS "reviewRound" INTEGER;

WITH handovers AS (
  SELECT
    ca."id" AS asset_id,
    ROW_NUMBER() OVER (PARTITION BY ca."articleId" ORDER BY al."createdAt", al."id") AS round
  FROM "AuditLog" al
  JOIN "ContentAsset" ca ON al."entity" = 'ContentAsset:' || ca."id"
  WHERE al."action" = 'asset.status'
    AND al."detail" LIKE '%"status":"IN_REVIEW"%'
)
UPDATE "ContentAsset" c
SET "reviewRound" = h.round
FROM (SELECT asset_id, MAX(round) AS round FROM handovers GROUP BY asset_id) h
WHERE c."id" = h.asset_id
  AND c."reviewRound" IS NULL;
