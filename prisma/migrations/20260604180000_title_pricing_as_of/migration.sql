-- Internal per-title "prices as of" date so the desk can tell current
-- prices from stale ones. Distinct from lastVerifiedAt. Idempotent.
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "pricingAsOf" TIMESTAMP(3);
