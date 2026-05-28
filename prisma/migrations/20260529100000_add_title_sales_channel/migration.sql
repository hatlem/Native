-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('DIRECT', 'IN_HOUSE', 'REP');

-- AlterTable
ALTER TABLE "Title" ADD COLUMN "salesChannel" "SalesChannel";

-- CreateIndex
CREATE INDEX "Title_salesChannel_idx" ON "Title"("salesChannel");

-- Backfill from the CSV `adSales` string.
-- DIRECT: the publisher sells its own ads — contact the title directly.
UPDATE "Title" SET "salesChannel" = 'DIRECT'
WHERE "adSales" ILIKE 'Direkte hos%'
   OR "adSales" ILIKE 'Direct from publisher%'
   OR "adSales" ILIKE '%selvstendig%'
   OR "adSales" ILIKE '%independent%'
   OR "adSales" ILIKE '%self-publish%';

-- REP: independent third-party rep houses representing unrelated titles
-- (true middlemen).
UPDATE "Title" SET "salesChannel" = 'REP'
WHERE "salesChannel" IS NULL
  AND (
       "adSales" ILIKE 'HS Media%'
    OR "adSales" ILIKE 'A2 Media%'
    OR "adSales" ILIKE 'Salgsfabrikken%'
    OR "adSales" ILIKE 'Iconic Media%'
  );

-- IN_HOUSE: everything else with a known sales arm is the publisher group's
-- own ad department (Bonnier News Brands, Amedia Salg, Schibsted SMS, …).
UPDATE "Title" SET "salesChannel" = 'IN_HOUSE'
WHERE "salesChannel" IS NULL
  AND "adSales" IS NOT NULL;
