-- Card facts must come from the publication, not platform defaults.

-- 1) Publisher-stated inclusions/exclusions live on the quote; copy them
--    onto the product so the catalog can render what the MEDIA says the
--    price covers.
ALTER TABLE "Product" ADD COLUMN "includedText" TEXT;
ALTER TABLE "Product" ADD COLUMN "excludedText" TEXT;

UPDATE "Product" p
SET "includedText" = q."includedText",
    "excludedText" = q."excludedText"
FROM "PriceQuote" q
WHERE p."confirmedSource" = 'PriceQuote:' || q.id
  AND (q."includedText" IS NOT NULL OR q."excludedText" IS NOT NULL);

-- 2) Lead time: 10 was the schema default, not publisher data. Null =
--    unknown; the UI hides the row. Quote-created products never carried
--    a publisher lead time.
ALTER TABLE "Product" ALTER COLUMN "leadTimeDays" DROP NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "leadTimeDays" DROP DEFAULT;

UPDATE "Product"
SET "leadTimeDays" = NULL
WHERE "confirmedSource" LIKE 'PriceQuote:%';

-- 3) Where the publisher's own offer text says production is included,
--    zero our production fee so the band stops double-counting it.
--    Phrases match the ingest texts verbatim (SE/DK/NO variants).
UPDATE "Product" p
SET "productionFee" = 0
FROM "PriceQuote" q
WHERE p."confirmedSource" = 'PriceQuote:' || q.id
  AND p."productionFee" IS NULL
  AND (
    COALESCE(q."includedText", '') || ' ' || COALESCE(p."description", '') ILIKE ANY (ARRAY[
      '%inkl. produktion%', '%inkl produktion%', '%produktion ingår%',
      '%produktion utifrån brief%', '%textframtagning%',
      '%skrivs av contentredakt%', '%redaktionen skriver%',
      '%inkl. journalist%', '%inkl produksjon%', '%inkl. produksjon%',
      '%produksjon inkludert%', '%inkl. produktion.%', '%inkl. prod%'
    ])
  );
