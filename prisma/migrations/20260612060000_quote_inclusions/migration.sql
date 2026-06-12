-- Structured buyer-safe deliverables on the quote itself, copied to the
-- Product when the quote is applied.
ALTER TABLE "PriceQuote" ADD COLUMN "inclusions" JSONB;
