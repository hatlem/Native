-- Desk-owned default commission (%). Null marketCode = global fallback;
-- most-specific active row wins. No rows -> code falls back to 15.
CREATE TABLE "MarginRule" (
    "id" TEXT NOT NULL,
    "marketCode" "MarketCode",
    "marginPct" DECIMAL(5,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarginRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarginRule_active_marketCode_idx" ON "MarginRule"("active", "marketCode");
