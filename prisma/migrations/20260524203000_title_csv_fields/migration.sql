-- Loosen Title/Publisher market FKs and enrich Title with the CSV
-- research-catalog fields (see prisma/data/medier_alle.csv). Lets us
-- store all 3155 Nordic + European media outlets in one Title table.

-- ---------- Publisher: nullable marketId + countryCode ----------

ALTER TABLE "Publisher" ADD COLUMN "countryCode" TEXT;

-- Backfill countryCode from the linked Market for existing rows.
UPDATE "Publisher" p
  SET "countryCode" = m."code"::text
  FROM "Market" m
  WHERE p."marketId" = m."id";

ALTER TABLE "Publisher" ALTER COLUMN "countryCode" SET NOT NULL;

-- Drop the old (marketId, name) unique index and the FK NOT NULL so we
-- can recreate the FK as nullable. (Prisma 6 represents @@unique as an
-- index, not a table constraint.)
DROP INDEX "Publisher_marketId_name_key";
ALTER TABLE "Publisher" DROP CONSTRAINT "Publisher_marketId_fkey";
ALTER TABLE "Publisher" ALTER COLUMN "marketId" DROP NOT NULL;
ALTER TABLE "Publisher"
  ADD CONSTRAINT "Publisher_marketId_fkey"
  FOREIGN KEY ("marketId") REFERENCES "Market"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Publisher_countryCode_name_key"
  ON "Publisher"("countryCode", "name");
CREATE INDEX "Publisher_marketId_idx" ON "Publisher"("marketId");

-- ---------- Title: nullable marketId + CSV fields ----------

ALTER TABLE "Title" ADD COLUMN "countryCode" TEXT;

UPDATE "Title" t
  SET "countryCode" = m."code"::text
  FROM "Market" m
  WHERE t."marketId" = m."id";

ALTER TABLE "Title" ALTER COLUMN "countryCode" SET NOT NULL;

ALTER TABLE "Title" DROP CONSTRAINT "Title_marketId_fkey";
ALTER TABLE "Title" ALTER COLUMN "marketId" DROP NOT NULL;
ALTER TABLE "Title"
  ADD CONSTRAINT "Title_marketId_fkey"
  FOREIGN KEY ("marketId") REFERENCES "Market"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Research-catalog metadata columns. All nullable — they describe the
-- title for filtering/search and are not required by any commerce flow.
ALTER TABLE "Title" ADD COLUMN "type" TEXT;
ALTER TABLE "Title" ADD COLUMN "frequency" TEXT;
ALTER TABLE "Title" ADD COLUMN "ownerGroup" TEXT;
ALTER TABLE "Title" ADD COLUMN "publisherName" TEXT;
ALTER TABLE "Title" ADD COLUMN "adSales" TEXT;
ALTER TABLE "Title" ADD COLUMN "locationNote" TEXT;
ALTER TABLE "Title" ADD COLUMN "circulation" INTEGER;
ALTER TABLE "Title" ADD COLUMN "vertical" TEXT;
ALTER TABLE "Title" ADD COLUMN "audience" TEXT;
ALTER TABLE "Title" ADD COLUMN "b2bB2c" TEXT;
ALTER TABLE "Title" ADD COLUMN "reach" TEXT;
ALTER TABLE "Title" ADD COLUMN "format" TEXT;
ALTER TABLE "Title" ADD COLUMN "nativeFit" TEXT;
ALTER TABLE "Title" ADD COLUMN "tags" TEXT;
ALTER TABLE "Title" ADD COLUMN "urlStatus" TEXT;

-- Indexes on the columns the catalog UI filters by.
CREATE INDEX "Title_countryCode_idx" ON "Title"("countryCode");
CREATE INDEX "Title_type_idx" ON "Title"("type");
CREATE INDEX "Title_category_idx" ON "Title"("category");
CREATE INDEX "Title_vertical_idx" ON "Title"("vertical");
CREATE INDEX "Title_b2bB2c_idx" ON "Title"("b2bB2c");
CREATE INDEX "Title_nativeFit_idx" ON "Title"("nativeFit");
CREATE INDEX "Title_format_idx" ON "Title"("format");
CREATE INDEX "Title_reach_idx" ON "Title"("reach");
CREATE INDEX "Title_frequency_idx" ON "Title"("frequency");
CREATE INDEX "Title_ownerGroup_idx" ON "Title"("ownerGroup");
