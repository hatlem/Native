-- Per-plan catalog-relevance targeting: which verticals (Title.vertical values,
-- CSV) this specific plan is aimed at, independent of the org-wide behavioral
-- signal, so one org can run multiple plans with different profiles.

-- AlterTable
ALTER TABLE "SavedList" ADD COLUMN "targetVerticals" TEXT;
