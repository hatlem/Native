-- Access to an advertiser org now comes only from an ACTIVE Membership
-- (src/lib/workspace.ts resolveWorkspace). User.organizationId — the home org
-- pointer — no longer grants anything by itself. It used to, which is why a
-- member whose account was created by an invite claim (the claim points the
-- new account's home org at the inviting org) kept full access after being
-- revoked or after their delegation ran out.
--
-- No row changes for those members: their REVOKED / EXPIRED seat already says
-- what should happen, and the code change is what makes it bite.
--
-- The one population the code change would otherwise cut off by accident: a
-- user whose home org is an advertiser org but who has NO Membership row for
-- it at all — never invited, never revoked (e.g. bound to an org by a
-- super-admin with "leave the seat as it is"). Their access came purely from
-- the implicit grant, which never carried a role or ordering rights. Give
-- them exactly that as an explicit seat: MEMBER without commit. Everyone
-- with ANY row for their home org — active, revoked or expired — is left
-- alone (ON CONFLICT DO NOTHING on the [userId, organizationId] unique).
-- Agency home orgs are excluded: an agency's reach comes from parentOrgId,
-- not from seats, and is unchanged.
--
-- Reversible: every row inserted here shares this transaction's now(), so
--   DELETE FROM "Membership" WHERE "createdAt" = '<applied-at>' AND role = 'MEMBER' AND "invitedById" IS NULL;
-- removes exactly them (look up <applied-at> from the rows or from
-- _prisma_migrations.started_at).
INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "canCommit", "expiresAt", "status", "invitedById", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u."id",
  u."organizationId",
  'MEMBER',
  false,
  NULL,
  'ACTIVE',
  NULL,
  now(),
  now()
FROM "User" u
JOIN "Organization" o ON o."id" = u."organizationId"
WHERE o."type" = 'ADVERTISER'
ON CONFLICT ("userId", "organizationId") DO NOTHING;
