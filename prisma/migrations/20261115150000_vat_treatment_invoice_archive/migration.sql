-- VAT treatment is decided by the buyer's country (lib/vat.ts) and stored on
-- the quote, the invoice and the credit note. Existing rows keep their stored
-- vatPct and get a NULL treatment: nothing already sent or issued is
-- recomputed. Additive only; reverse with DROP COLUMN / DROP TYPE.
CREATE TYPE "VatTreatment" AS ENUM ('DOMESTIC', 'REVERSE_CHARGE');

ALTER TABLE "Quote"
  ADD COLUMN "vatTreatment" "VatTreatment",
  ADD COLUMN "vatNote" TEXT;

ALTER TABLE "Invoice"
  ADD COLUMN "vatTreatment" "VatTreatment",
  ADD COLUMN "vatNote" TEXT,
  ADD COLUMN "pdfObjectKey" TEXT;

ALTER TABLE "CreditNote"
  ADD COLUMN "vatTreatment" "VatTreatment",
  ADD COLUMN "vatNote" TEXT;
