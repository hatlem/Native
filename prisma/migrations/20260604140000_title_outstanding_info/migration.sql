-- Structured list of commercial info still needed per title (gap tracking),
-- replacing freetext "missing X" notes in commercialExtra. Idempotent.
ALTER TABLE "Title" ADD COLUMN IF NOT EXISTS "outstandingInfo" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
