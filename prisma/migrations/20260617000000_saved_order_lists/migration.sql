-- Saved order lists: a buyer-curated, persistent list of catalog products
-- and/or whole titles (title-line items, productId null) that an org can
-- save, edit, and later submit as a Plan + Request.
-- Hand-authored (migrate dev blocked; no reachable shadow DB in this env,
-- and it wants to drop the externally-managed `searchTsv` tsvector column).
-- All new columns on existing tables are nullable — safe to apply on the
-- live prod DB with zero downtime.

-- CreateTable: SavedList
CREATE TABLE IF NOT EXISTS "SavedList" (
  "id"             TEXT         NOT NULL,
  "organizationId" TEXT         NOT NULL,
  "name"           TEXT         NOT NULL DEFAULT 'Untitled list',
  "note"           TEXT,
  "budget"         DECIMAL(12,2),
  "currency"       TEXT,
  "goal"           TEXT,
  "audienceNote"   TEXT,
  "targetGeo"      TEXT,
  "targetAudience" TEXT,
  "targetContext"  TEXT,
  "createdById"    TEXT,
  "archivedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedList_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SavedList_organizationId_archivedAt_idx"
  ON "SavedList"("organizationId", "archivedAt");

-- CreateTable: SavedListItem
-- invariant "exactly one of productId/titleId" enforced in the app layer (lib/lists.ts)
CREATE TABLE IF NOT EXISTS "SavedListItem" (
  "id"             TEXT             NOT NULL,
  "listId"         TEXT             NOT NULL,
  "productId"      TEXT,
  "titleId"        TEXT,
  "quantity"       INTEGER          NOT NULL DEFAULT 1,
  "withContent"    BOOLEAN          NOT NULL DEFAULT false,
  "authorshipMode" "AuthorshipMode" NOT NULL DEFAULT 'BUYER_SUPPLIED',
  "notes"          TEXT,
  "sortOrder"      INTEGER          NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedListItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SavedListItem_listId_idx"
  ON "SavedListItem"("listId");

-- AlterTable: PlanItem — productId optional, add title-line support
ALTER TABLE "PlanItem" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "PlanItem" ADD COLUMN IF NOT EXISTS "titleId" TEXT;

-- AlterTable: Request — provenance back to the SavedList it was submitted from
ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "sourceListId" TEXT;

-- Foreign keys (guarded for idempotency)

DO $$ BEGIN
  ALTER TABLE "SavedList"
    ADD CONSTRAINT "SavedList_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "SavedListItem"
    ADD CONSTRAINT "SavedListItem_listId_fkey" FOREIGN KEY ("listId")
    REFERENCES "SavedList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "SavedListItem"
    ADD CONSTRAINT "SavedListItem_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "SavedListItem"
    ADD CONSTRAINT "SavedListItem_titleId_fkey" FOREIGN KEY ("titleId")
    REFERENCES "Title"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Request"
    ADD CONSTRAINT "Request_sourceListId_fkey" FOREIGN KEY ("sourceListId")
    REFERENCES "SavedList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
