-- A RESTRICTED seat is view-only: it reads the org's plans, requests,
-- quotes, orders, reports, articles and invoices and changes none of them
-- (lib/membership.ts roleCanEdit / commitGrantFor). Commit authority (accept a
-- quote, place an order) is the strongest write there is, so a view-only seat
-- never carries it. The team page let an admin tick "can commit" on a
-- restricted seat; clear any such grant, then make the database refuse it,
-- the same way ADMIN seats are made to always carry it.
--
-- Rollback: DROP the two constraints. The cleared grants were never usable
-- once the code reads the role, so nothing needs restoring.
UPDATE "Membership" SET "canCommit" = false WHERE role = 'RESTRICTED' AND "canCommit" = true;
UPDATE "OrgInvite" SET "canCommit" = false WHERE role = 'RESTRICTED' AND "canCommit" = true;

ALTER TABLE "Membership" DROP CONSTRAINT IF EXISTS "Membership_restricted_never_commits";
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_restricted_never_commits" CHECK (role <> 'RESTRICTED' OR NOT "canCommit");
ALTER TABLE "OrgInvite" DROP CONSTRAINT IF EXISTS "OrgInvite_restricted_never_commits";
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_restricted_never_commits" CHECK (role <> 'RESTRICTED' OR NOT "canCommit");
