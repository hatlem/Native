-- Semantic, buyer-exposable inclusions: structured facts rendered via
-- i18n templates in every locale. Internal quote text stays desk-only.
ALTER TABLE "Product" ADD COLUMN "inclusions" JSONB;
