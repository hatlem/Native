-- An ADMIN seat always carries commit authority (accept quotes, place
-- orders). An admin could always grant it to anyone, themselves included, so
-- "admin without commit" was never a restriction, only a dead end the first
-- time they tried to accept a quote (lib/membership.ts commitGrantFor).
UPDATE "Membership" SET "canCommit" = true WHERE role = 'ADMIN' AND "canCommit" = false;
UPDATE "OrgInvite" SET "canCommit" = true WHERE role = 'ADMIN' AND "canCommit" = false;

ALTER TABLE "Membership" DROP CONSTRAINT IF EXISTS "Membership_admin_commits";
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_admin_commits" CHECK (role <> 'ADMIN' OR "canCommit");
ALTER TABLE "OrgInvite" DROP CONSTRAINT IF EXISTS "OrgInvite_admin_commits";
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_admin_commits" CHECK (role <> 'ADMIN' OR "canCommit");
