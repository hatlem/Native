-- Market.fxToEUR — local-to-EUR rate used only for the buyer-facing
-- "approx. €X at today's rate" presentation on multi-market campaigns.
-- Local currency stays canonical for quotes, invoices and publisher
-- payments. NULL = the market is already EUR (DE, AT, IE, FI).
--
-- Baseline rates seeded below are 2026 ballpark figures (1 local = X
-- EUR). The desk can refresh from /desk/markets when we add that UI
-- or via SQL until then.

ALTER TABLE "Market"
  ADD COLUMN IF NOT EXISTS "fxToEUR" DECIMAL(12,6);

UPDATE "Market" SET "fxToEUR" = 0.087000 WHERE "code" = 'NO';   -- 1 NOK ≈ 0.087 EUR
UPDATE "Market" SET "fxToEUR" = 0.091000 WHERE "code" = 'SE';   -- 1 SEK ≈ 0.091 EUR
UPDATE "Market" SET "fxToEUR" = 0.134000 WHERE "code" = 'DK';   -- 1 DKK ≈ 0.134 EUR (DKK pegged to EUR)
UPDATE "Market" SET "fxToEUR" = 1.042000 WHERE "code" = 'CH';   -- 1 CHF ≈ 1.042 EUR
UPDATE "Market" SET "fxToEUR" = 1.176000 WHERE "code" = 'UK';   -- 1 GBP ≈ 1.176 EUR
-- DE/AT/IE/FI stay NULL — they already report in EUR.
