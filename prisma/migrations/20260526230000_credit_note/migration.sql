-- Credit note table — the second half of the cancellation story.
-- Order goes CANCELLED → the issued invoice gets a CreditNote refund
-- row + Invoice.status → CREDITED. We don't void the invoice itself
-- because the "what was billed" record must stay legible for VAT
-- filing (PLAN §13).

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'CREDITED';

-- CreateTable
CREATE TABLE IF NOT EXISTS "CreditNote" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "reason" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");
CREATE INDEX IF NOT EXISTS "CreditNote_orderId_idx" ON "CreditNote"("orderId");

ALTER TABLE "CreditNote"
  ADD CONSTRAINT "CreditNote_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreditNote"
  ADD CONSTRAINT "CreditNote_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
