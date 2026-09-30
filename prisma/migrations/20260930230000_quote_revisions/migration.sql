-- Sent quotes are immutable; changes go out as revisions
-- (lib/commerce/quote-revision.ts).
--
-- The desk used to be able to reprice a quote the buyer had already received
-- (SENT, not yet accepted) without the buyer being told. Now a SENT quote is
-- locked: "Revise quote" opens a new DRAFT that copies its lines, numbered
-- (revision) and linked to its predecessor (previousQuoteId). Sending the
-- revision flips the predecessor to SUPERSEDED (supersededAt) — no longer
-- acceptable — and notifies the buyer once with the new total.
--
-- Purely additive. Every existing quote is revision 1 with no predecessor.
-- Rollback: DROP the three columns and the index; the enum value can stay
-- (Postgres can't drop one) and is unused once the code is reverted.

ALTER TYPE "QuoteStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

ALTER TABLE "Quote" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Quote" ADD COLUMN "previousQuoteId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "supersededAt" TIMESTAMP(3);

-- At most one revision per quote: two desk users clicking "Revise" at once
-- can't fork the chain (the second insert fails on this index).
CREATE UNIQUE INDEX "Quote_previousQuoteId_key" ON "Quote"("previousQuoteId");

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_previousQuoteId_fkey"
  FOREIGN KEY ("previousQuoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_revision_positive" CHECK ("revision" >= 1);
