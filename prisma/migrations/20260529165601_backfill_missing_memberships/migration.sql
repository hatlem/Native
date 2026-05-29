-- Heal any user that has a home org but no ADMIN membership for it — e.g.
-- accounts created between the membership deploy and the register-flow fix,
-- where org creation didn't yet write a Membership row. Idempotent:
-- ON CONFLICT DO NOTHING, so re-running is a no-op for existing memberships.
INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "canCommit", "expiresAt", "status", "invitedById", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u."id",
  u."organizationId",
  'ADMIN',
  true,
  NULL,
  'ACTIVE',
  NULL,
  now(),
  now()
FROM "User" u
WHERE u."organizationId" IS NOT NULL
ON CONFLICT ("userId", "organizationId") DO NOTHING;
