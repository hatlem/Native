-- "We write it" (SavedListItem.withContent) must drive authorshipMode. The
-- toggle and the add path used to write only withContent, leaving
-- authorshipMode at its BUYER_SUPPLIED default — so an RFQ snapshot carried
-- "buyer supplies the copy", the desk quote got no content-fee line and the
-- order line could not be staffed with a writer. Code now writes the pair
-- through lib/authorship.ts contentIntent(); this aligns existing rows and
-- makes the invariant load-bearing in the database.
-- Hand-authored (migrate dev blocked; no reachable shadow DB in this env).
--
-- Rollback: ALTER TABLE "SavedListItem" DROP CONSTRAINT
--   "SavedListItem_authorship_matches_content";
-- (The backfill only corrects rows to what the buyer's toggle already shows.)

-- The backfill is a data repair, not a buyer edit: keep the per-row "touch
-- the list" trigger from moving every affected plan's "Sist endret".
ALTER TABLE "SavedListItem" DISABLE TRIGGER saved_list_item_touch_list;

-- withContent is what the buyer sees pressed on /plan, so it wins.
-- On but not NativeSpin-produced: the bug above (the obvious disagreement).
UPDATE "SavedListItem"
  SET "authorshipMode" = 'NATIVESPIN_PRODUCED'
  WHERE "withContent" = true AND "authorshipMode" <> 'NATIVESPIN_PRODUCED';

-- Off but NativeSpin-produced: no code path writes this, but the CHECK below
-- would reject it, so fold any such row back to the historical off meaning.
-- PUBLISHER_PRODUCED rows (withContent = false) are consistent and untouched.
UPDATE "SavedListItem"
  SET "authorshipMode" = 'BUYER_SUPPLIED'
  WHERE "withContent" = false AND "authorshipMode" = 'NATIVESPIN_PRODUCED';

ALTER TABLE "SavedListItem" ENABLE TRIGGER saved_list_item_touch_list;

-- Backstop every present and future writer (same pattern as the OrderLine
-- writer CHECK): the toggle and the mode can never disagree again.
DO $$ BEGIN
  ALTER TABLE "SavedListItem" ADD CONSTRAINT "SavedListItem_authorship_matches_content"
    CHECK ("withContent" = ("authorshipMode" = 'NATIVESPIN_PRODUCED'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
