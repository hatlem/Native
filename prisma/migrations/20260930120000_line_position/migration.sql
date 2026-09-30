-- Stable display order for quote, order and invoice lines.
--
-- Readers had no ORDER BY on lines, so Postgres returned them in physical
-- order — and an UPDATE (e.g. the desk repricing a quote line) rewrites the
-- row at the end of the heap, making the line jump to the bottom on the next
-- render. `position` is the generation order; every reader now sorts by
-- (position, id).
--
-- Additive and reversible: DROP COLUMN "position" on the three tables undoes it.

ALTER TABLE "QuoteLine"   ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderLine"   ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceLine" ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows in their generation order. Lines were always
-- inserted placements first, then content-fee lines, in one nested create;
-- cuid ids are time-ordered within that insert, so (kind, id) reproduces it.
UPDATE "QuoteLine" ql
SET "position" = ranked.pos
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "quoteId"
           ORDER BY CASE kind WHEN 'INVENTORY' THEN 0 ELSE 1 END, id
         ) - 1 AS pos
  FROM "QuoteLine"
) ranked
WHERE ranked.id = ql.id;

UPDATE "OrderLine" ol
SET "position" = ranked.pos
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "orderId"
           ORDER BY CASE kind WHEN 'INVENTORY' THEN 0 ELSE 1 END, id
         ) - 1 AS pos
  FROM "OrderLine"
) ranked
WHERE ranked.id = ol.id;

UPDATE "InvoiceLine" il
SET "position" = ranked.pos
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "invoiceId" ORDER BY id) - 1 AS pos
  FROM "InvoiceLine"
) ranked
WHERE ranked.id = il.id;
