-- Additive only. Three things:
--   1. Indexes on the commerce foreign keys every org-scoped list and line
--      include filters on (they were sequential scans).
--   2. Gap-free document numbers for invoices and credit notes, allocated
--      from DocumentCounter inside the issuing transaction, plus the
--      customer/seller snapshot an issued invoice keeps.
--   3. AuditLog.organizationId so the trail can be filtered per tenant.
-- Reverse with: DROP the indexes/columns/table below (no data is rewritten
-- except the number backfill, which only fills NULLs).

CREATE INDEX IF NOT EXISTS "Plan_organizationId_idx" ON "Plan"("organizationId");
CREATE INDEX IF NOT EXISTS "PlanItem_planId_idx" ON "PlanItem"("planId");
CREATE INDEX IF NOT EXISTS "Request_organizationId_idx" ON "Request"("organizationId");
CREATE INDEX IF NOT EXISTS "Quote_requestId_idx" ON "Quote"("requestId");
CREATE INDEX IF NOT EXISTS "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");
CREATE INDEX IF NOT EXISTS "Order_organizationId_idx" ON "Order"("organizationId");
CREATE INDEX IF NOT EXISTS "OrderLine_orderId_idx" ON "OrderLine"("orderId");
CREATE INDEX IF NOT EXISTS "Invoice_orderId_idx" ON "Invoice"("orderId");
CREATE INDEX IF NOT EXISTS "Invoice_organizationId_idx" ON "Invoice"("organizationId");
CREATE INDEX IF NOT EXISTS "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "AuditLog_actor_idx" ON "AuditLog"("actor");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

CREATE TABLE IF NOT EXISTS "DocumentCounter" (
    "series" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("series")
);

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "number" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "customerSnapshot" JSONB;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "sellerSnapshot" JSONB;
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "number" INTEGER;

-- Backfill: already-issued documents get 1..n in the order they were issued.
WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "issuedAt" ASC, "createdAt" ASC, "id" ASC) AS n
  FROM "Invoice"
  WHERE "issuedAt" IS NOT NULL AND "number" IS NULL
)
UPDATE "Invoice" i SET "number" = ordered.n FROM ordered WHERE i."id" = ordered."id";

WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "issuedAt" ASC, "createdAt" ASC, "id" ASC) AS n
  FROM "CreditNote"
  WHERE "number" IS NULL
)
UPDATE "CreditNote" c SET "number" = ordered.n FROM ordered WHERE c."id" = ordered."id";

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_number_key" ON "Invoice"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "CreditNote_number_key" ON "CreditNote"("number");

INSERT INTO "DocumentCounter" ("series", "next")
SELECT 'invoice', COALESCE(MAX("number"), 0) + 1 FROM "Invoice"
ON CONFLICT ("series") DO NOTHING;
INSERT INTO "DocumentCounter" ("series", "next")
SELECT 'credit_note', COALESCE(MAX("number"), 0) + 1 FROM "CreditNote"
ON CONFLICT ("series") DO NOTHING;
