-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByRole" "UserRole" NOT NULL,
    "assignedWriterId" TEXT,
    "orderLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Article_orderLineId_key" ON "Article"("orderLineId");
CREATE INDEX "Article_organizationId_idx" ON "Article"("organizationId");
CREATE INDEX "Article_assignedWriterId_idx" ON "Article"("assignedWriterId");

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Article" ADD CONSTRAINT "Article_assignedWriterId_fkey" FOREIGN KEY ("assignedWriterId") REFERENCES "WriterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Article" ADD CONSTRAINT "Article_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one Article per existing ContentBrief that has at least one
-- ContentAsset version. organizationId comes from the order; title is
-- derived from the placement's product/title name, falling back to a
-- truncated brief message, then to "Untitled article"; createdByUserId
-- is the earliest version *that has* an author (a v1 with no author and
-- a v2 with one picks v2's author), falling back to any DESK/SUPERADMIN
-- user, since every org has at least one desk account managing it.
-- createdByRole is resolved from that SAME user (via the author_pick CTE
-- + join to User) rather than hardcoded, so the two columns can never
-- disagree about who/what role created the row.
WITH author_pick AS (
  SELECT
    cb.id AS brief_id,
    COALESCE(
      (SELECT wp."userId" FROM "ContentAsset" ca
         JOIN "WriterProfile" wp ON wp.id = ca."authorWriterId"
        WHERE ca."briefId" = cb.id ORDER BY ca."version" ASC LIMIT 1),
      (SELECT u.id FROM "User" u WHERE u.role IN ('DESK', 'SUPERADMIN') ORDER BY u."createdAt" ASC LIMIT 1)
    ) AS user_id
  FROM "ContentBrief" cb
)
INSERT INTO "Article" ("id", "organizationId", "title", "createdByUserId", "createdByRole", "assignedWriterId", "orderLineId", "createdAt", "updatedAt")
SELECT
  'mig_' || cb.id,
  o."organizationId",
  COALESCE(t."name", NULLIF(LEFT(cb."message", 80), ''), 'Untitled article'),
  usr.id,
  usr.role,
  ol."assignedWriterId",
  cb."orderLineId",
  cb."createdAt",
  cb."updatedAt"
FROM "ContentBrief" cb
JOIN "OrderLine" ol ON ol.id = cb."orderLineId"
JOIN "Order" o ON o.id = ol."orderId"
LEFT JOIN "Product" p ON p.id = ol."productId"
LEFT JOIN "Title" t ON t.id = p."titleId"
JOIN author_pick au ON au.brief_id = cb.id
JOIN "User" usr ON usr.id = au.user_id
-- Two kinds of brief need an Article: one that already owns drafts, and
-- one on a line that is staffed but not yet written (the journalist is
-- locked out of the writer page without an Article to write into).
WHERE EXISTS (SELECT 1 FROM "ContentAsset" ca WHERE ca."briefId" = cb.id)
   OR ol."assignedWriterId" IS NOT NULL;

-- AlterTable: add articleId (nullable first so the UPDATE below can run)
ALTER TABLE "ContentAsset" ADD COLUMN "articleId" TEXT;

UPDATE "ContentAsset" SET "articleId" = 'mig_' || "briefId";

-- Every ContentAsset row now has an articleId (backfilled above, since
-- the INSERT's WHERE EXISTS guarantees an Article exists for every brief
-- that owns at least one asset). Make it required and drop the old FK.
ALTER TABLE "ContentAsset" ALTER COLUMN "articleId" SET NOT NULL;
ALTER TABLE "ContentAsset" DROP CONSTRAINT "ContentAsset_briefId_fkey";
ALTER TABLE "ContentAsset" DROP COLUMN "briefId";
ALTER TABLE "ContentAsset" ADD CONSTRAINT "ContentAsset_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ContentAsset_articleId_idx" ON "ContentAsset"("articleId");
