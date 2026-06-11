-- Sweep of all ingest waves found two more mistyped quote-created
-- products (same class as the Polaris video fix):
-- a bundled package and a print full-page typed as NATIVE_ARTICLE.
UPDATE "Product" SET "type" = 'PACKAGE'
WHERE "type" = 'NATIVE_ARTICLE'
  AND "confirmedSource" LIKE 'PriceQuote:%'
  AND "name" ILIKE 'native komplett%';

UPDATE "Product" SET "type" = 'ADVERTORIAL'
WHERE "type" = 'NATIVE_ARTICLE'
  AND "confirmedSource" LIKE 'PriceQuote:%'
  AND "name" ILIKE 'nativeannons helsida%';
