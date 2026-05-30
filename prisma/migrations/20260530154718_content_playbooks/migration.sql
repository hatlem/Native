-- Phase 4 content playbooks.
CREATE TABLE "Playbook" (
    "id" TEXT NOT NULL,
    "productType" "ProductType",
    "category" TEXT,
    "marketCode" "MarketCode",
    "title" TEXT NOT NULL,
    "angle" TEXT,
    "structure" TEXT,
    "doList" TEXT,
    "dontList" TEXT,
    "exampleHeadlines" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Playbook_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Playbook_active_productType_category_marketCode_idx" ON "Playbook"("active", "productType", "category", "marketCode");
