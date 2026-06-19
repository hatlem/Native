-- Favorites: personal publication shortlists, optionally shared with the org.
-- Additive only — three new tables + indexes; no changes to existing tables.

CREATE TABLE "Favorite" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "titleId"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FavoriteList" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "organizationId" TEXT,
  "name"           TEXT NOT NULL DEFAULT 'Untitled list',
  "sharedWithOrg"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FavoriteList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FavoriteListItem" (
  "id"         TEXT NOT NULL,
  "listId"     TEXT NOT NULL,
  "favoriteId" TEXT NOT NULL,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FavoriteListItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Favorite_userId_titleId_key" ON "Favorite"("userId", "titleId");
CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite"("userId", "createdAt");
CREATE INDEX "FavoriteList_userId_idx" ON "FavoriteList"("userId");
CREATE INDEX "FavoriteList_organizationId_sharedWithOrg_idx" ON "FavoriteList"("organizationId", "sharedWithOrg");
CREATE UNIQUE INDEX "FavoriteListItem_listId_favoriteId_key" ON "FavoriteListItem"("listId", "favoriteId");
CREATE INDEX "FavoriteListItem_listId_sortOrder_idx" ON "FavoriteListItem"("listId", "sortOrder");

ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavoriteList" ADD CONSTRAINT "FavoriteList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavoriteList" ADD CONSTRAINT "FavoriteList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FavoriteListItem" ADD CONSTRAINT "FavoriteListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "FavoriteList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavoriteListItem" ADD CONSTRAINT "FavoriteListItem_favoriteId_fkey" FOREIGN KEY ("favoriteId") REFERENCES "Favorite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
