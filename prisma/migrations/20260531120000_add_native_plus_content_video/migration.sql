-- New product formats: Native Plus (shoppable) + Content Video.
-- ALTER TYPE ... ADD VALUE coexists with unrelated ADD COLUMN in one file
-- (see 20260526210000_order_cancellation_and_editorial_veto) because nothing
-- here inserts rows using the new enum values.

-- AlterEnum: ProductType
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'NATIVE_PLUS';
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'CONTENT_VIDEO';

-- AlterTable: Spec
ALTER TABLE "Spec"
  ADD COLUMN IF NOT EXISTS "videoMaxSeconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "videoHosting" TEXT,
  ADD COLUMN IF NOT EXISTS "shoppableMaxProducts" INTEGER,
  ADD COLUMN IF NOT EXISTS "ctaGuidance" TEXT;
