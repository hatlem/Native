-- Order cancellation + editorial veto
--
-- Closes Kirsten R2 / scenario coverage matrix items #1, #5, #6:
--   - cancelOrder action exists (schema didn't have the audit fields)
--   - ContentAssetStatus.RETRACTED (hard veto, distinct from CHANGES_REQUESTED)
--   - NotificationKind.EDITORIAL_VETO + ORDER_CANCELLED so the buyer
--     dashboard can surface these as their own row, not another nudge.

-- AlterEnum: ContentAssetStatus
ALTER TYPE "ContentAssetStatus" ADD VALUE IF NOT EXISTS 'RETRACTED';

-- AlterEnum: NotificationKind
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'EDITORIAL_VETO';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'ORDER_CANCELLED';

-- AlterTable: Order
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledBy" TEXT;

-- AlterTable: ContentAsset
ALTER TABLE "ContentAsset"
  ADD COLUMN IF NOT EXISTS "retractedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "retractedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "retractionNote" TEXT;
