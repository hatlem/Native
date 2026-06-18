-- Saved-list integrity & idempotency hardening (adversarial-audit remediation).
--   1) remove (null,null) orphan items (reachable today via product/title hard-deletes
--      such as scripts/merge-*-dupes.ts, because the old FK was ON DELETE SET NULL)
--   2) merge duplicate product/title rows created by the pre-fix add race
--   3) enforce exactly-one-of(productId,titleId) via a CHECK constraint
--   4) make product/title FKs ON DELETE CASCADE (a list line for a deleted
--      product/title has no meaning — drop it instead of nulling it into an orphan)
--   5) NULL-distinct unique indexes backing add-idempotency (Postgres treats NULL
--      as distinct, so title rows (productId NULL) and product rows (titleId NULL)
--      never collide — uniqueness is enforced only among real product/title refs)
--   6) (listId,sortOrder) index for deterministic render ordering + FK backing
-- Safe to apply on live prod: all data is cleaned BEFORE the constraints are added.

-- 1) orphans first (CHECK below would otherwise reject them)
DELETE FROM "SavedListItem" WHERE "productId" IS NULL AND "titleId" IS NULL;

-- 2a) merge duplicate PRODUCT rows: sum quantity (capped at 20) onto the earliest
--     survivor, then delete the rest, so the new unique index can be created.
WITH agg AS (
  SELECT "listId", "productId",
         LEAST(SUM("quantity"), 20) AS total,
         (ARRAY_AGG("id" ORDER BY "createdAt", "id"))[1] AS keep_id
  FROM "SavedListItem"
  WHERE "productId" IS NOT NULL
  GROUP BY "listId", "productId"
  HAVING COUNT(*) > 1
)
UPDATE "SavedListItem" s SET "quantity" = agg.total
FROM agg WHERE s."id" = agg.keep_id;

DELETE FROM "SavedListItem" s USING (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "listId","productId" ORDER BY "createdAt","id") AS rn
  FROM "SavedListItem" WHERE "productId" IS NOT NULL
) d WHERE s."id" = d."id" AND d.rn > 1;

-- 2b) dedup TITLE placeholder rows: keep the earliest
DELETE FROM "SavedListItem" s USING (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "listId","titleId" ORDER BY "createdAt","id") AS rn
  FROM "SavedListItem" WHERE "titleId" IS NOT NULL
) d WHERE s."id" = d."id" AND d.rn > 1;

-- 3) exactly-one invariant (CHECK) — DB-level enforcement, not just app code
DO $$ BEGIN
  ALTER TABLE "SavedListItem"
    ADD CONSTRAINT "SavedListItem_one_ref_chk"
    CHECK ((("productId" IS NOT NULL)::int + ("titleId" IS NOT NULL)::int) = 1);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4) product/title FKs: SET NULL -> CASCADE (no more (null,null) orphans)
ALTER TABLE "SavedListItem" DROP CONSTRAINT IF EXISTS "SavedListItem_productId_fkey";
ALTER TABLE "SavedListItem" DROP CONSTRAINT IF EXISTS "SavedListItem_titleId_fkey";
DO $$ BEGIN
  ALTER TABLE "SavedListItem"
    ADD CONSTRAINT "SavedListItem_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "SavedListItem"
    ADD CONSTRAINT "SavedListItem_titleId_fkey" FOREIGN KEY ("titleId")
    REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 5) idempotency unique indexes (NULL-distinct, so multi title/product rows are fine)
CREATE UNIQUE INDEX IF NOT EXISTS "SavedListItem_listId_productId_key"
  ON "SavedListItem"("listId","productId");
CREATE UNIQUE INDEX IF NOT EXISTS "SavedListItem_listId_titleId_key"
  ON "SavedListItem"("listId","titleId");

-- 6) deterministic ordering + FK-backing index; the bare listId index is now
--    redundant (every query has listId as a left-prefix of one of the above).
CREATE INDEX IF NOT EXISTS "SavedListItem_listId_sortOrder_idx"
  ON "SavedListItem"("listId","sortOrder");
DROP INDEX IF EXISTS "SavedListItem_listId_idx";
