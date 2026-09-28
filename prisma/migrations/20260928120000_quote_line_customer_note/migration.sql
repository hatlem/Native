-- Customer-visible per-line note on quotes ("Merknad"), seeded from the
-- plan line's note and editable by the desk.
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "customerNote" TEXT;
