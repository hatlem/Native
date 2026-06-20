-- Favorites follow-ups (code-review remediation).
--
-- 1) favoriteId-led index. getListMembershipForTitles runs on every catalog
--    render and joins FavoriteListItem on favoriteId; the active-item _count
--    subqueries do too. Only listId-led indexes existed, so these fell to a
--    sequential scan that grows org-wide. Additive, no behavior change.
CREATE INDEX IF NOT EXISTS "FavoriteListItem_favoriteId_idx"
  ON "FavoriteListItem"("favoriteId");

-- 2) Re-scope existing favorites lists to the OWNER'S home org. Sharing was
--    keyed off the volatile activeOrgId client-switch cookie, so an agency
--    user's list could have landed under the selected CLIENT org (cross-tenant
--    visibility). The correct share scope is the owner's employer org
--    (User.organization). This backfills every list to its owner's home org;
--    for advertisers it is a no-op (already their org). Lists whose owner has
--    no home org become NULL (un-shareable), matching the new app guard.
UPDATE "FavoriteList" fl
SET "organizationId" = u."organizationId"
FROM "User" u
WHERE u."id" = fl."userId"
  AND fl."organizationId" IS DISTINCT FROM u."organizationId";
