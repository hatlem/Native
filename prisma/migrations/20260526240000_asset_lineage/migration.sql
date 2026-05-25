-- Asset lineage — ContentAsset.sourceAssetId self-reference so a
-- writer can flag a draft as an adaptation of a previously-shipped
-- piece. Closes Maja R2's "content asset library cross-market reuse"
-- gap (DK → SE adaptation should be a first-class relation, not a
-- copy-paste with no audit trail).

ALTER TABLE "ContentAsset"
  ADD COLUMN IF NOT EXISTS "sourceAssetId" TEXT;

CREATE INDEX IF NOT EXISTS "ContentAsset_sourceAssetId_idx"
  ON "ContentAsset"("sourceAssetId");

ALTER TABLE "ContentAsset"
  ADD CONSTRAINT "ContentAsset_sourceAssetId_fkey"
  FOREIGN KEY ("sourceAssetId") REFERENCES "ContentAsset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
