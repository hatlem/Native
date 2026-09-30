-- Accounting sync state on invoices and credit notes, plus structured
-- invoice-line fields so documents can show human labels.
--
-- Purely additive (nullable columns / a defaulted enum column): safe to
-- deploy ahead of the code, reversible by dropping the added columns.
--
-- accountingProvider records which provider handled the push ("noop" when
-- none is configured, so "kept local on purpose" is distinguishable from
-- "never attempted" on legacy rows). accountingError holds the last failed
-- push, shown to the desk until a retry succeeds.
ALTER TABLE "Invoice"
  ADD COLUMN "accountingProvider" TEXT,
  ADD COLUMN "accountingRef" TEXT,
  ADD COLUMN "accountingNumber" TEXT,
  ADD COLUMN "accountingSyncedAt" TIMESTAMP(3),
  ADD COLUMN "accountingError" TEXT;

ALTER TABLE "CreditNote"
  ADD COLUMN "accountingProvider" TEXT,
  ADD COLUMN "accountingRef" TEXT,
  ADD COLUMN "accountingNumber" TEXT,
  ADD COLUMN "accountingSyncedAt" TIMESTAMP(3),
  ADD COLUMN "accountingError" TEXT;

-- Snapshot of what the line bills, captured at issue time. Legacy rows keep
-- only `description`; renderers fall back to parsing it.
ALTER TABLE "InvoiceLine"
  ADD COLUMN "kind" "LineKind" NOT NULL DEFAULT 'INVENTORY',
  ADD COLUMN "productId" TEXT,
  ADD COLUMN "titleName" TEXT,
  ADD COLUMN "productType" "ProductType";
