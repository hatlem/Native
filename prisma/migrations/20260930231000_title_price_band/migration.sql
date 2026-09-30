-- Stored catalog price band per title, so the catalog's price-band filter can
-- filter and page in the database (Title.priceBandTier, indexed).
--
-- The band itself is computed in TypeScript (lib/pricing/title-band.ts), by
-- the same titleBand() the catalog card shows — SQL never re-implements the
-- margin, fee-cascade or bucket logic. What lives here is the INVALIDATION:
-- every write that can move a band bumps Title.priceBandRev, whichever code
-- path made it (desk pricing, quote apply/activate, the publisher portal, MCP
-- tools, scripts, raw SQL). A title's stored tier is current exactly when
-- priceBandComputedRev = priceBandRev; lib/pricing/title-band.ts recomputes
-- the stale ones before the catalog filters on them, and an hourly sweep
-- keeps the backlog near zero.
--
-- Backfill: every existing row starts stale (rev 1, computed 0), so the
-- first sweep (two minutes after boot) or the first filtered catalog request
-- computes all of them with the real band logic. Nothing here guesses a band.
--
-- Purely additive. Hand-authored (migrate dev blocked; no shadow DB).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS product_price_band_touch ON "Product";
--   DROP TRIGGER IF EXISTS price_rule_price_band_touch ON "PriceRule";
--   DROP TRIGGER IF EXISTS title_price_band_touch ON "Title";
--   DROP TRIGGER IF EXISTS publisher_price_band_touch ON "Publisher";
--   DROP TRIGGER IF EXISTS margin_rule_price_band_touch ON "MarginRule";
--   DROP TRIGGER IF EXISTS content_fee_rule_price_band_touch ON "ContentFeeRule";
--   DROP FUNCTION IF EXISTS price_band_touch_from_product(), price_band_touch_from_price_rule(),
--     price_band_touch_title(), price_band_touch_from_publisher(), price_band_touch_all();
--   DROP INDEX IF EXISTS "Title_priceBand_stale_idx";
--   DROP INDEX IF EXISTS "Title_priceBandTier_idx";
--   ALTER TABLE "Title" DROP COLUMN "priceBandTier", DROP COLUMN "priceBandRev",
--     DROP COLUMN "priceBandComputedRev";

ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "priceBandTier" INTEGER;
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "priceBandRev" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "priceBandComputedRev" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "Title_priceBandTier_idx" ON "Title"("priceBandTier");
-- The recompute's work queue: only stale rows, so "anything to do?" is an
-- index probe that is empty almost all the time.
CREATE INDEX IF NOT EXISTS "Title_priceBand_stale_idx" ON "Title"("id")
  WHERE "priceBandRev" <> "priceBandComputedRev";

-- ---------------------------------------------------------------------------
-- Product: price, currency, pricing model, type (NATIVE_ARTICLE leads the
-- card band), visibility, activeness, confirmation, the article fee and the
-- curated inclusions (a publisher-written article carries no fee of ours) —
-- and a product moving between titles touches both.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION price_band_touch_from_product() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE "Title" SET "priceBandRev" = "priceBandRev" + 1 WHERE id = OLD."titleId";
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW."titleId" IS DISTINCT FROM OLD."titleId") THEN
    UPDATE "Title" SET "priceBandRev" = "priceBandRev" + 1 WHERE id = NEW."titleId";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_price_band_touch ON "Product";
CREATE TRIGGER product_price_band_touch
  AFTER INSERT OR DELETE OR UPDATE OF
    "titleId", "type", "pricingModel", "basePrice", "currency", "visibility",
    "active", "confirmedAt", "productionFee", "inclusions"
  ON "Product"
  FOR EACH ROW EXECUTE FUNCTION price_band_touch_from_product();

-- ---------------------------------------------------------------------------
-- PriceRule: the product's margin / seasonal multiplier.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION price_band_touch_from_price_rule() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE "Title" SET "priceBandRev" = "priceBandRev" + 1
      WHERE id = (SELECT "titleId" FROM "Product" WHERE id = OLD."productId");
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW."productId" IS DISTINCT FROM OLD."productId") THEN
    UPDATE "Title" SET "priceBandRev" = "priceBandRev" + 1
      WHERE id = (SELECT "titleId" FROM "Product" WHERE id = NEW."productId");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS price_rule_price_band_touch ON "PriceRule";
CREATE TRIGGER price_rule_price_band_touch
  AFTER INSERT OR UPDATE OR DELETE ON "PriceRule"
  FOR EACH ROW EXECUTE FUNCTION price_band_touch_from_price_rule();

-- ---------------------------------------------------------------------------
-- Title: its own price visibility, its article-fee default, and a move to
-- another market (margin/fee rules) or publisher (publisher visibility).
-- BEFORE UPDATE so the bump rides on the same row write. The recompute's own
-- write (priceBandTier / priceBandComputedRev) touches none of these columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION price_band_touch_title() RETURNS trigger AS $$
BEGIN
  NEW."priceBandRev" := OLD."priceBandRev" + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS title_price_band_touch ON "Title";
CREATE TRIGGER title_price_band_touch
  BEFORE UPDATE OF "pricesPublic", "productionFeeDefault", "marketId", "publisherId" ON "Title"
  FOR EACH ROW
  WHEN (
    OLD."pricesPublic" IS DISTINCT FROM NEW."pricesPublic"
    OR OLD."productionFeeDefault" IS DISTINCT FROM NEW."productionFeeDefault"
    OR OLD."marketId" IS DISTINCT FROM NEW."marketId"
    OR OLD."publisherId" IS DISTINCT FROM NEW."publisherId"
  )
  EXECUTE FUNCTION price_band_touch_title();

-- ---------------------------------------------------------------------------
-- Publisher: the publisher-wide price visibility switch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION price_band_touch_from_publisher() RETURNS trigger AS $$
BEGIN
  UPDATE "Title" SET "priceBandRev" = "priceBandRev" + 1 WHERE "publisherId" = NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS publisher_price_band_touch ON "Publisher";
CREATE TRIGGER publisher_price_band_touch
  AFTER UPDATE OF "pricesPublic" ON "Publisher"
  FOR EACH ROW
  WHEN (OLD."pricesPublic" IS DISTINCT FROM NEW."pricesPublic")
  EXECUTE FUNCTION price_band_touch_from_publisher();

-- ---------------------------------------------------------------------------
-- Desk margin and content-fee rules apply across titles: any change
-- invalidates every band (rare desk edits; the recompute is batched).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION price_band_touch_all() RETURNS trigger AS $$
BEGIN
  UPDATE "Title" SET "priceBandRev" = "priceBandRev" + 1;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS margin_rule_price_band_touch ON "MarginRule";
CREATE TRIGGER margin_rule_price_band_touch
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "MarginRule"
  FOR EACH STATEMENT EXECUTE FUNCTION price_band_touch_all();

DROP TRIGGER IF EXISTS content_fee_rule_price_band_touch ON "ContentFeeRule";
CREATE TRIGGER content_fee_rule_price_band_touch
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "ContentFeeRule"
  FOR EACH STATEMENT EXECUTE FUNCTION price_band_touch_all();
