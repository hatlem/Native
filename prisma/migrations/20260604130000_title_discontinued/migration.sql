-- Title discontinued markers: preserve THAT and WHY a title is defunct,
-- distinct from a temporary `active=false`. Idempotent / additive.
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "discontinuedAt" TIMESTAMP(3);
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "discontinuedNote" TEXT;
