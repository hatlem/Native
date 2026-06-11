-- Per-offer / per-publication overrides for the content-production fee
-- folded into the displayed all-in price band. Both nullable; null =
-- inherit (Title default -> ContentFeeRule desk price list).
ALTER TABLE "Product" ADD COLUMN "productionFee" DECIMAL(12,2);
ALTER TABLE "Title" ADD COLUMN "productionFeeDefault" DECIMAL(12,2);
