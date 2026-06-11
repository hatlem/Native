-- Extend the marketplace footprint to the Netherlands and Belgium.
-- Both are EUR markets; Market rows (currency/VAT/disclosure) are inserted
-- idempotently by scripts/ingest-intl-titles-0611.ts (and prisma/seed.ts for
-- a fresh DB). England/Scotland/Wales/Northern Ireland are NOT new codes —
-- they are modelled as `Title.region` within the existing UK market.
ALTER TYPE "MarketCode" ADD VALUE IF NOT EXISTS 'NL';
ALTER TYPE "MarketCode" ADD VALUE IF NOT EXISTS 'BE';
