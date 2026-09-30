-- Extra work beyond an article's included scope (extra revision rounds,
-- interviews, images), billed per hour.
--
--   * ExtraWorkRate: the hourly rate per billing currency, shown to the buyer
--     wherever the article fee is explained and used by the desk to bill
--     hours. Seeded with the agreed defaults; SUPERADMIN edits them on
--     /desk/content-fees.
--   * LineKind EXTRA_WORK + QuoteLine/InvoiceLine hours and hourlyRate: a
--     desk-added hours line on a DRAFT quote, and its invoice line.
--   * OrderExtraWork: hours billed after the quote was accepted (the accepted
--     quote is immutable); they become invoice lines when the invoice is
--     issued (lib/billing.ts), which stamps invoiceId.
--
-- Additive. Hand-authored (migrate dev blocked; no reachable shadow DB).
--
-- Rollback (Postgres cannot drop an enum value; EXTRA_WORK just stays unused):
--   DROP TABLE IF EXISTS "OrderExtraWork";
--   DROP TABLE IF EXISTS "ExtraWorkRate";
--   ALTER TABLE "QuoteLine" DROP COLUMN IF EXISTS "hours", DROP COLUMN IF EXISTS "hourlyRate";
--   ALTER TABLE "InvoiceLine" DROP COLUMN IF EXISTS "hours", DROP COLUMN IF EXISTS "hourlyRate";

ALTER TYPE "LineKind" ADD VALUE IF NOT EXISTS 'EXTRA_WORK';

CREATE TABLE IF NOT EXISTS "ExtraWorkRate" (
  "id"         TEXT NOT NULL,
  "currency"   TEXT NOT NULL,
  "hourlyRate" DECIMAL(12,2) NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExtraWorkRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExtraWorkRate_currency_key" ON "ExtraWorkRate"("currency");

-- The agreed defaults (lib/pricing/extra-work.ts DEFAULT_EXTRA_WORK_RATES).
-- ON CONFLICT DO NOTHING: a rate already set is never overwritten.
INSERT INTO "ExtraWorkRate" ("id", "currency", "hourlyRate", "updatedAt") VALUES
  ('ewr_nok', 'NOK', 1650, now()),
  ('ewr_eur', 'EUR', 140, now()),
  ('ewr_sek', 'SEK', 1600, now()),
  ('ewr_dkk', 'DKK', 1050, now()),
  ('ewr_gbp', 'GBP', 120, now()),
  ('ewr_chf', 'CHF', 130, now())
ON CONFLICT ("currency") DO NOTHING;

ALTER TABLE "QuoteLine"
  ADD COLUMN IF NOT EXISTS "hours" DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS "hourlyRate" DECIMAL(12,2);

ALTER TABLE "InvoiceLine"
  ADD COLUMN IF NOT EXISTS "hours" DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS "hourlyRate" DECIMAL(12,2);

CREATE TABLE IF NOT EXISTS "OrderExtraWork" (
  "id"          TEXT NOT NULL,
  "orderId"     TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "hours"       DECIMAL(6,2) NOT NULL,
  "hourlyRate"  DECIMAL(12,2) NOT NULL,
  "currency"    TEXT NOT NULL,
  "lineTotal"   DECIMAL(12,2) NOT NULL,
  "createdById" TEXT NOT NULL,
  "invoiceId"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderExtraWork_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderExtraWork_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderExtraWork_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "OrderExtraWork_orderId_idx" ON "OrderExtraWork"("orderId");
CREATE INDEX IF NOT EXISTS "OrderExtraWork_invoiceId_idx" ON "OrderExtraWork"("invoiceId");
