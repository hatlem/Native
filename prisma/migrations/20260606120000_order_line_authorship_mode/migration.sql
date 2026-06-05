-- Per-line content authorship: who writes the article (buyer / NativeSpin /
-- publisher). A separate axis from LineKind (the billing axis). Carried
-- Plan→Order so a confirmed order always records production intent instead of
-- leaving "buyer supplied" and "publisher produced" as indistinguishable rows.
-- Hand-authored (migrate dev blocked; no reachable shadow DB in this env).
-- Columns default BUYER_SUPPLIED — the historical withContent=false meaning —
-- so existing rows are correct and the apply is zero-downtime.

-- CreateEnum: AuthorshipMode
DO $$ BEGIN
  CREATE TYPE "AuthorshipMode" AS ENUM ('BUYER_SUPPLIED', 'NATIVESPIN_PRODUCED', 'PUBLISHER_PRODUCED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AlterTable: PlanItem + OrderLine
ALTER TABLE "PlanItem" ADD COLUMN IF NOT EXISTS "authorshipMode" "AuthorshipMode" NOT NULL DEFAULT 'BUYER_SUPPLIED';
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "authorshipMode" "AuthorshipMode" NOT NULL DEFAULT 'BUYER_SUPPLIED';

-- Backfill PlanItem from the existing withContent toggle so historical plans
-- reflect the intent that was actually captured.
UPDATE "PlanItem" SET "authorshipMode" = 'NATIVESPIN_PRODUCED' WHERE "withContent" = true;

-- Best-effort backfill of existing order lines (near-zero in practice).
-- CONTENT_FEE lines exist only when NativeSpin produces.
UPDATE "OrderLine" SET "authorshipMode" = 'NATIVESPIN_PRODUCED' WHERE "kind" = 'CONTENT_FEE';

-- INVENTORY lines inherit their plan item's intent, matched by product within
-- the same plan (OrderLine → Order → Quote → Request → Plan → PlanItem).
-- The UPDATE target alias `ol` can only be correlated from the top-level WHERE,
-- not from a FROM-list JOIN's ON clause, so the product match lives in WHERE.
UPDATE "OrderLine" ol SET "authorshipMode" = pi."authorshipMode"
  FROM "Order" o
  JOIN "Quote" q ON q."id" = o."quoteId"
  JOIN "Request" r ON r."id" = q."requestId"
  JOIN "PlanItem" pi ON pi."planId" = r."planId"
  WHERE ol."orderId" = o."id"
    AND pi."productId" = ol."productId"
    AND ol."kind" = 'INVENTORY'
    AND pi."authorshipMode" <> 'BUYER_SUPPLIED';

-- Reconcile pre-existing writer assignments with the invariant this slice
-- introduces. The writer-pool feature shipped one day earlier with no
-- authorship gate, so a writer could have been assigned to a line that is no
-- longer staffable (a CONTENT_FEE billing line, or a buyer/publisher-produced
-- placement). Clear those orphaned assignments so the new gate can't leave a
-- line stranded — assigned yet unreachable from the desk UI.
UPDATE "OrderLine"
  SET "assignedWriterId" = NULL, "assignedAt" = NULL, "assignedById" = NULL
  WHERE "assignedWriterId" IS NOT NULL
    AND NOT ("kind" = 'INVENTORY' AND "authorshipMode" = 'NATIVESPIN_PRODUCED');

-- Make the invariant load-bearing at the DB layer (matches the existing
-- PriceQuote product-xor-draft CHECK pattern): a writer may only be attached
-- to an INVENTORY placement NativeSpin produces. Backstops every present and
-- future write path, not just the assign action.
DO $$ BEGIN
  ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_writer_requires_nativespin_placement"
    CHECK ("assignedWriterId" IS NULL OR ("kind" = 'INVENTORY' AND "authorshipMode" = 'NATIVESPIN_PRODUCED'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
