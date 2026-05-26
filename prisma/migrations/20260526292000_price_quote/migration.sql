-- CreateTable: PriceQuote
CREATE TABLE IF NOT EXISTS "PriceQuote" (
    "id"               TEXT NOT NULL,
    "priceRequestId"   TEXT,
    "productId"        TEXT,
    "draftProductType" "ProductType",
    "draftProductName" TEXT,
    "draftProductDesc" TEXT,
    "price"            DECIMAL(12, 2) NOT NULL,
    "currency"         TEXT NOT NULL,
    "includedText"     TEXT,
    "excludedText"     TEXT,
    "validUntil"       TIMESTAMP(3),
    "appliedAt"        TIMESTAMP(3),
    "appliedById"      TEXT,
    "rejectedAt"       TIMESTAMP(3),
    "rejectedById"     TEXT,
    "rejectedReason"   TEXT,
    "recordedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById"     TEXT NOT NULL,

    CONSTRAINT "PriceQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PriceQuote_productId_idx" ON "PriceQuote"("productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PriceQuote_priceRequestId_idx" ON "PriceQuote"("priceRequestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PriceQuote_appliedAt_idx" ON "PriceQuote"("appliedAt");

-- AddForeignKey: PriceQuote -> PriceRequest
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_priceRequestId_fkey"
    FOREIGN KEY ("priceRequestId") REFERENCES "PriceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: PriceQuote -> Product
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: PriceQuote -> User (appliedBy)
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_appliedById_fkey"
    FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- XOR CHECK: either references an existing Product, or carries draft-product fields — never both, never neither
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_product_xor_draft"
  CHECK (
    ("productId" IS NOT NULL AND "draftProductType" IS NULL)
    OR
    ("productId" IS NULL AND "draftProductType" IS NOT NULL AND "draftProductName" IS NOT NULL)
  );
