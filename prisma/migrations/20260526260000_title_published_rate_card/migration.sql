-- Title.publishedRateCard / publishedRateCurrency — the publisher's
-- public rate-card price for a standard sponsored placement. Used
-- as the customer-facing *anchor* on quotes ("Rate card €X → your
-- price €Y") to reframe the deal as a discount instead of a markup.
-- Editorial input only; commerce price still flows via Product.basePrice.

ALTER TABLE "Title"
  ADD COLUMN IF NOT EXISTS "publishedRateCard"     DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "publishedRateCurrency" TEXT;
