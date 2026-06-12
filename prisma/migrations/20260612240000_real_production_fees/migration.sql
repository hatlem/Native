-- Real production fees (user: ~2 000 NOK for a written article). Bands
-- were inflated by the 12 000 kr seed placeholders. Only rows still
-- carrying the seed note are touched — desk edits are never overwritten.
-- Krone markets: article 2 000 / other formats 1 500 (adaptation = half).
-- EUR/GBP/CHF markets: article 200 / other 150.

UPDATE "ContentFeeRule" SET
  "greenfieldFee" = CASE WHEN currency IN ('NOK','SEK','DKK')
                         THEN CASE WHEN "productType" = 'NATIVE_ARTICLE' THEN 2000 ELSE 1500 END
                         ELSE CASE WHEN "productType" = 'NATIVE_ARTICLE' THEN 200 ELSE 150 END END,
  "adaptationFee" = CASE WHEN currency IN ('NOK','SEK','DKK')
                         THEN CASE WHEN "productType" = 'NATIVE_ARTICLE' THEN 1000 ELSE 750 END
                         ELSE CASE WHEN "productType" = 'NATIVE_ARTICLE' THEN 100 ELSE 75 END END,
  note = 'Standard produksjonskostnad satt 2026-06-12 (artikkel 2000 kr / 200 EUR-skala). Juster i /desk/content-fees.',
  "updatedAt" = now()
WHERE note LIKE 'Seed placeholder%';
