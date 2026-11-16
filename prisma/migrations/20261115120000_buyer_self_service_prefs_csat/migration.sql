-- Additive only. Buyer self-service (decline quote / withdraw request /
-- request cancellation), per-user email notification preferences, and the
-- post-order CSAT answer. Reverse with: DROP TABLE "OrderFeedback"; and
-- ALTER TABLE ... DROP COLUMN for each column below (enum values stay).

ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'QUOTE_DECLINED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'REQUEST_WITHDRAWN';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'ORDER_CANCELLATION_REQUESTED';

ALTER TABLE "Quote" ADD COLUMN "declinedAt" TIMESTAMP(3), ADD COLUMN "declineReason" TEXT;
ALTER TABLE "Request" ADD COLUMN "withdrawnAt" TIMESTAMP(3), ADD COLUMN "withdrawReason" TEXT;
ALTER TABLE "Order"
  ADD COLUMN "cancellationRequestedAt" TIMESTAMP(3),
  ADD COLUMN "cancellationRequestReason" TEXT,
  ADD COLUMN "cancellationRequestedBy" TEXT;

ALTER TABLE "User" ADD COLUMN "emailMutedCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "OrderFeedback" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderFeedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderFeedback_orderId_key" ON "OrderFeedback"("orderId");
CREATE INDEX "OrderFeedback_userId_idx" ON "OrderFeedback"("userId");
ALTER TABLE "OrderFeedback" ADD CONSTRAINT "OrderFeedback_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderFeedback" ADD CONSTRAINT "OrderFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
