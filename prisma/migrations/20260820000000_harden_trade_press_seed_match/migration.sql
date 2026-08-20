-- Hardens the Norsk Sjømat / Fretta.no keyword seed from migration
-- 20260701040000_trade_press_keywords_and_domain_aliases, which matched by
-- exact `name` only because no prod slug could be confirmed via MCP at
-- authoring time (native_get_title returned null for the guessed slugs).
--
-- Verified now via MCP native_search_titles + native_get_title (2026-08-20):
-- both rows exist in prod and the earlier name-matched UPDATE already landed
-- correctly —
--   norsk-sj-mat-no ("Norsk Sjømat"): keywords = [havbruk, sjømat, fiskeri, fisk]
--   fretta-no-no    ("Fretta.no"):    keywords = [havbruk, sjømat, fiskeri, fisk]
--
-- This migration doesn't change any data (the DISTINCT-unnest merge below is
-- a no-op against those rows today); it exists to stop relying on `name`
-- alone going forward — a title rename would silently no-op the original
-- migration on a fresh environment. Matching by the confirmed slug as well
-- closes that gap. Idempotent: safe to re-run, and a genuine no-op for any
-- environment where these slugs don't exist.

UPDATE "Title" SET
  keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY[
    'sjømat', 'fiskeri', 'havbruk', 'fisk'
  ])),
  "updatedAt" = now()
WHERE slug IN ('norsk-sj-mat-no', 'fretta-no-no')
   OR name IN ('Norsk Sjømat', 'Fretta.no');
