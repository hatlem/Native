-- Revenue model: content-fee lines distinct from inventory lines.

-- CreateEnum
CREATE TYPE "LineKind" AS ENUM ('INVENTORY', 'CONTENT_FEE');

-- AlterTable: QuoteLine gains kind; productId becomes nullable (content-fee lines have no product)
ALTER TABLE "QuoteLine" ADD COLUMN "kind" "LineKind" NOT NULL DEFAULT 'INVENTORY';
ALTER TABLE "QuoteLine" ALTER COLUMN "productId" DROP NOT NULL;

-- AlterTable: OrderLine gains kind; productId becomes nullable
ALTER TABLE "OrderLine" ADD COLUMN "kind" "LineKind" NOT NULL DEFAULT 'INVENTORY';
ALTER TABLE "OrderLine" ALTER COLUMN "productId" DROP NOT NULL;

-- AlterTable: PlanItem gains per-placement content-production flag
ALTER TABLE "PlanItem" ADD COLUMN "withContent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: desk-owned content-production price list
CREATE TABLE "ContentFeeRule" (
    "id" TEXT NOT NULL,
    "marketCode" "MarketCode",
    "productType" "ProductType",
    "currency" TEXT NOT NULL,
    "greenfieldFee" DECIMAL(12,2) NOT NULL,
    "adaptationFee" DECIMAL(12,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentFeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentFeeRule_active_productType_marketCode_idx" ON "ContentFeeRule"("active", "productType", "marketCode");
