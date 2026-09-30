-- A placement the publisher's own studio writes (Product.inclusions.production
-- = 'PUBLISHER', or an explicit production fee of 0 on the offer or, with no
-- offer fee, on the publication — lib/authorship.ts publisherProducesContent)
-- has no "We write it" toggle any more: /plan says the publisher writes the
-- article, and the fee engine never bills our content fee on it
-- (BUG-final-prod-1). Before, the toggle showed unticked with no hint, and
-- ticking it added our fee for an article the publisher already produces.
--
-- This aligns the open plans that went through that toggle: such a line is
-- PUBLISHER_PRODUCED, whatever was pressed (on, or on and off again, which
-- left it BUYER_SUPPLIED). Submitted plans, quotes and orders are untouched.
-- Hand-authored (migrate dev blocked; no reachable shadow DB in this env).
--
-- Rollback: nothing to undo structurally. The update only corrects rows to
-- what the code now enforces; the previous toggle state was the bug.

-- A data repair, not a buyer edit: keep the per-row "touch the list" trigger
-- from moving every affected plan's "Sist endret".
ALTER TABLE "SavedListItem" DISABLE TRIGGER saved_list_item_touch_list;

UPDATE "SavedListItem" AS i
  SET "withContent" = false, "authorshipMode" = 'PUBLISHER_PRODUCED'
  FROM "Product" AS p
  JOIN "Title" AS t ON t."id" = p."titleId"
  WHERE i."productId" = p."id"
    AND i."authorshipMode" <> 'PUBLISHER_PRODUCED'
    AND (
      p."inclusions" ->> 'production' = 'PUBLISHER'
      -- First set fee wins (resolveProductionFee): the offer's, else the
      -- publication's; an explicit 0 means the publisher includes production.
      OR (p."productionFee" IS NOT NULL AND p."productionFee" = 0)
      OR (p."productionFee" IS NULL AND t."productionFeeDefault" = 0)
    );

ALTER TABLE "SavedListItem" ENABLE TRIGGER saved_list_item_touch_list;
