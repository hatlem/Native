-- Add the CSV research-catalog columns to Title (see
-- prisma/data/medier_alle.csv) so all 3,150+ Nordic + European media
-- outlets are filterable from a single table. Also denormalises the
-- country code onto Title/Publisher so catalog filtering can hit an
-- index without joining Market.

-- ---------- Publisher.countryCode (denormalized) ----------

ALTER TABLE "Publisher" ADD COLUMN "countryCode" TEXT;

UPDATE "Publisher" p
  SET "countryCode" = m."code"::text
  FROM "Market" m
  WHERE p."marketId" = m."id";

ALTER TABLE "Publisher" ALTER COLUMN "countryCode" SET NOT NULL;
CREATE INDEX "Publisher_countryCode_idx" ON "Publisher"("countryCode");

-- ---------- Title.countryCode + CSV columns ----------

ALTER TABLE "Title" ADD COLUMN "countryCode" TEXT;

UPDATE "Title" t
  SET "countryCode" = m."code"::text
  FROM "Market" m
  WHERE t."marketId" = m."id";

ALTER TABLE "Title" ALTER COLUMN "countryCode" SET NOT NULL;

-- Research-catalog metadata columns. All nullable — they describe the
-- title for filtering / search and are not required by any commerce flow.
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
