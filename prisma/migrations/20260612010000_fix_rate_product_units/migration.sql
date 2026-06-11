-- Data repair: quote-created products inherited pricingModel FLAT even
-- when the applied PriceQuote was a CPM/CPC rate, so the band engine
-- rendered rates as per-placement prices (Adresseavisen "< 15k" bug).
-- Copy the unit from the applied quote onto its product.
UPDATE "Product" p
SET "pricingModel" = q."priceUnit"::text::"PricingModel"
FROM "PriceQuote" q
WHERE p."confirmedSource" = 'PriceQuote:' || q.id
  AND q."priceUnit" <> 'FLAT'
  AND p."pricingModel" = 'FLAT';

-- Ingest mistyped Polaris video-native offers as NATIVE_ARTICLE; the
-- names say what they are.
UPDATE "Product"
SET "type" = 'CONTENT_VIDEO'
WHERE "type" = 'NATIVE_ARTICLE'
  AND "confirmedSource" LIKE 'PriceQuote:%'
  AND ("name" ILIKE 'video – %' OR "name" ILIKE 'video - %');
