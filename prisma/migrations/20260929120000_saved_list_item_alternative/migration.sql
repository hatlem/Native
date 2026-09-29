-- Recommended alternatives on a saved list: shown beside the plan, never
-- counted in totals or submitted until the buyer adds them.
ALTER TABLE "SavedListItem" ADD COLUMN IF NOT EXISTS "isAlternative" BOOLEAN NOT NULL DEFAULT false;
