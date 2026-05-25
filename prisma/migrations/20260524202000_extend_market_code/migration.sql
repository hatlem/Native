-- Extend MarketCode to cover the remaining countries present in
-- prisma/data/medier_alle.csv. Postgres requires that ALTER TYPE ADD
-- VALUE commits before the new values can be used, so this lives in a
-- separate migration before any column / seed step references them.

ALTER TYPE "MarketCode" ADD VALUE 'FI';
ALTER TYPE "MarketCode" ADD VALUE 'DE';
ALTER TYPE "MarketCode" ADD VALUE 'AT';
ALTER TYPE "MarketCode" ADD VALUE 'CH';
ALTER TYPE "MarketCode" ADD VALUE 'UK';
ALTER TYPE "MarketCode" ADD VALUE 'IE';
