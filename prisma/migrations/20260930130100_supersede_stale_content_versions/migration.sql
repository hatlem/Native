-- Backfill for the SUPERSEDED status: the same rule the app now applies
-- when a version is submitted for review, approved or finalized
-- (supersedeOlderVersions in src/lib/content/versions.ts). An open version
-- (draft, in review, changes requested) is superseded once a NEWER version
-- of the same article has been handed over for review or approved.
-- Approved and final versions are never touched — they are the record of
-- what was signed off, and FINAL ones may be locked by placements.
--
-- Data-only. To revert, the rows can be found by status = 'SUPERSEDED';
-- their previous status was one of the three open states and carried no
-- information beyond "not the current version".
UPDATE "ContentAsset" AS a
SET "status" = 'SUPERSEDED'
WHERE a."status" IN ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED')
  AND EXISTS (
    SELECT 1
    FROM "ContentAsset" AS b
    WHERE b."articleId" = a."articleId"
      AND b."version" > a."version"
      AND b."status" IN ('IN_REVIEW', 'APPROVED', 'FINAL')
  );
