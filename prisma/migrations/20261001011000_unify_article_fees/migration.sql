-- One article fee per market: a print advertorial costs the same to write as
-- a digital native article (decision 2026-09-30). Until now each market had
-- two desk rules: a NATIVE_ARTICLE rule (2 000 NOK / 200 EUR scale) and the
-- market's any-type rule (1 500 / 150), which priced ADVERTORIAL (print) and
-- every other format. Collapsed to ONE rule per market, so the two can't
-- drift apart again:
--
--   1. the market's any-type rule takes its NATIVE_ARTICLE rule's amounts
--      (whatever the desk set there, not a hard-coded figure);
--   2. a market with an article rule but no any-type rule gets one;
--   3. the market's NATIVE_ARTICLE and ADVERTORIAL rules are deactivated
--      (kept, not deleted: past quotes stay traceable to the rule that priced
--      them).
--
-- Explicit per-offer / per-publication fees (Product.productionFee,
-- Title.productionFeeDefault) are untouched: they beat the desk rule in the
-- production-fee cascade (lib/pricing/production-fee.ts). The price-band
-- trigger on ContentFeeRule marks every title's band stale, so catalog bands
-- are recomputed from the new amounts.
--
-- Each changed row's note records what it was, for the rollback:
--   UPDATE "ContentFeeRule" SET active = true, note = split_part(note, ' | unified 2026-10-01', 1)
--     WHERE note LIKE '% | unified 2026-10-01: deactivated%';
--   -- and restore each any-type rule's amounts from its note ("was X/Y").
--   DELETE FROM "ContentFeeRule" WHERE id LIKE 'cfr_unified_%';

DROP TABLE IF EXISTS _article_fee;
CREATE TEMP TABLE _article_fee AS
SELECT DISTINCT ON ("marketCode")
  "marketCode", "currency", "greenfieldFee", "adaptationFee"
FROM "ContentFeeRule"
WHERE "active" AND "productType" = 'NATIVE_ARTICLE'
ORDER BY "marketCode", "updatedAt" DESC, "id";

-- 1. The any-type rule takes the article amounts.
UPDATE "ContentFeeRule" g SET
  "note" = COALESCE(g."note", '') || ' | unified 2026-10-01: was '
           || g."greenfieldFee"::text || '/' || COALESCE(g."adaptationFee"::text, '-')
           || ', now the article fee for every format',
  "greenfieldFee" = a."greenfieldFee",
  "adaptationFee" = a."adaptationFee",
  "updatedAt" = now()
FROM _article_fee a
WHERE g."active"
  AND g."productType" IS NULL
  AND g."marketCode" IS NOT DISTINCT FROM a."marketCode"
  AND g."currency" = a."currency"
  AND (g."greenfieldFee" <> a."greenfieldFee"
       OR g."adaptationFee" IS DISTINCT FROM a."adaptationFee");

-- 2. No any-type rule in the market yet: create it from the article rule.
INSERT INTO "ContentFeeRule"
  ("id", "marketCode", "productType", "currency", "greenfieldFee", "adaptationFee", "active", "note", "createdAt", "updatedAt")
SELECT
  'cfr_unified_' || COALESCE(a."marketCode"::text, 'ALL'),
  a."marketCode", NULL, a."currency", a."greenfieldFee", a."adaptationFee", true,
  'unified 2026-10-01: one article fee for every format (from the NATIVE_ARTICLE rule)',
  now(), now()
FROM _article_fee a
WHERE NOT EXISTS (
  SELECT 1 FROM "ContentFeeRule" g
  WHERE g."active" AND g."productType" IS NULL
    AND g."marketCode" IS NOT DISTINCT FROM a."marketCode"
    AND g."currency" = a."currency"
)
ON CONFLICT ("id") DO NOTHING;

-- 3. Retire the per-format article rules the any-type rule now covers.
UPDATE "ContentFeeRule" r SET
  "active" = false,
  "note" = COALESCE(r."note", '') || ' | unified 2026-10-01: deactivated, the market rule now prices every format',
  "updatedAt" = now()
WHERE r."active"
  AND r."productType" IN ('NATIVE_ARTICLE', 'ADVERTORIAL')
  AND EXISTS (
    SELECT 1 FROM "ContentFeeRule" g
    WHERE g."active" AND g."productType" IS NULL
      AND g."marketCode" IS NOT DISTINCT FROM r."marketCode"
      AND g."currency" = r."currency"
  );

DROP TABLE _article_fee;
