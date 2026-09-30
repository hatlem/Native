-- Per-customer payment terms (net N days from invoice date), default 14.
-- One source of truth for the web quote, quote documents, invoice due date
-- and invoice text (lib/payment-terms.ts). Set by SUPERADMIN only.
--
-- Additive: existing organizations get the default. The CHECK mirrors
-- MIN/MAX_PAYMENT_TERMS_DAYS so a bad write can't reach an invoice.
-- Reversible by dropping the constraint and columns.
ALTER TABLE "Organization"
  ADD COLUMN "paymentTermsDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_paymentTermsDays_range"
  CHECK ("paymentTermsDays" BETWEEN 1 AND 120);

-- The terms an invoice was issued under, snapshotted so the invoice keeps
-- stating the terms its due date was computed from even if the customer's
-- terms change later. Null on invoices issued before this migration.
ALTER TABLE "Invoice" ADD COLUMN "paymentTermsDays" INTEGER;
