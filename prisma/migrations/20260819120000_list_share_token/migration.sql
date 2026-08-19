-- Client-share link for saved lists: read-only, tokened, no sign-in.
ALTER TABLE "SavedList" ADD COLUMN "shareToken" TEXT,
                        ADD COLUMN "shareCreatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "SavedList_shareToken_key" ON "SavedList"("shareToken");
