-- An instant (self-serve) order is idempotent per plan: a SavedList can have at
-- most one live instant order. Until now the only guard was a 30-second dedup
-- window, so an ordered plan still offered "Confirm order" and a later click
-- (a stale tab, a second visit) booked and charged the same plan a second
-- time (BUG-final-local-4). Request.instantOrderListId names the list an
-- instant order came from; its UNIQUE index makes a second live instant order
-- of the same list impossible, whatever races the application code loses.
-- The column is cleared when every order of the request is cancelled, which
-- releases the plan (lib/commerce/list-commit.ts).
-- Hand-authored (migrate dev blocked; no reachable shadow DB in this env).
--
-- Rollback:
--   DROP INDEX IF EXISTS "Request_instantOrderListId_key";
--   ALTER TABLE "Request" DROP COLUMN IF EXISTS "instantOrderListId";

ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "instantOrderListId" TEXT;

-- Backfill existing instant orders so their plans read "Ordered" too. The
-- instant path mints the request, its quotes and orders in one transaction,
-- so its orders are seconds old relative to the request; an accepted desk
-- quote is ordered long after the request was sent. Where a plan was already
-- ordered twice, the most recent live one holds the key (the unique index
-- below allows only one).
UPDATE "Request" AS r
  SET "instantOrderListId" = r."sourceListId"
  WHERE r."id" IN (
    SELECT DISTINCT ON (r2."sourceListId") r2."id"
    FROM "Request" AS r2
    JOIN "Quote" AS q ON q."requestId" = r2."id"
    JOIN "Order" AS o ON o."quoteId" = q."id"
    WHERE r2."sourceListId" IS NOT NULL
      AND o."status" <> 'CANCELLED'
      AND o."createdAt" - r2."createdAt" < interval '1 minute'
    ORDER BY r2."sourceListId", r2."createdAt" DESC
  )
  AND r."instantOrderListId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Request_instantOrderListId_key" ON "Request"("instantOrderListId");
