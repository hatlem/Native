import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { loadMemberships } from "./workspace";

// Regression guard: getWorkspace() resolves a multi-membership staff
// user's default active org as `membershipOrgIds[0]` — i.e. whatever
// loadMemberships() returns first. That query had no ORDER BY, so the
// "active" org was effectively random (DB row order). Found live: a
// staff account with an old, unrelated Membership silently landed on
// that org's empty plan instead of the client's real one, with no error
// and no switcher to correct it (the CLIENT_COOKIE switcher only exists
// for genuine AGENCY-org buyers, not staff). getWorkspace() itself can't
// be tested here — it calls Next's cookies(), which requires a live
// request scope node:test can't provide — so this exercises the actual
// fixed layer, loadMemberships(), directly.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

let userId = "";
let olderOrgId = "";
let newerOrgId = "";

before(async () => {
  if (!RUN_DB_IT) return;
  const market = await prisma.market.findFirst({ select: { code: true } });
  const older = await prisma.organization.create({
    data: { name: "Workspace IT Older Org", type: "ADVERTISER", marketCode: market!.code },
  });
  olderOrgId = older.id;
  const newer = await prisma.organization.create({
    data: { name: "Workspace IT Newer Org", type: "ADVERTISER", marketCode: market!.code },
  });
  newerOrgId = newer.id;
  const user = await prisma.user.create({
    data: { email: `workspace-it-${older.id}@example.com`, role: "SUPERADMIN" },
  });
  userId = user.id;
  // Older membership created first, matching the real staff account this
  // was found on: a pre-existing membership from long before the one that
  // actually matters for today's work.
  await prisma.membership.create({
    data: { userId, organizationId: olderOrgId, role: "ADMIN", canCommit: true, status: "ACTIVE" },
  });
  await prisma.membership.create({
    data: { userId, organizationId: newerOrgId, role: "ADMIN", canCommit: true, status: "ACTIVE" },
  });
});

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.membership.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: { in: [olderOrgId, newerOrgId] } } });
});

if (!RUN_DB_IT) {
  test("loadMemberships determinism (skipped — set RUN_DB_IT=1)", { skip: true }, () => {});
} else {
  test("loadMemberships returns the most recently granted membership first, not DB row order", async () => {
    const rows = await loadMemberships(userId);
    assert.equal(rows.length, 2);
    assert.equal(
      rows[0].organizationId,
      newerOrgId,
      "the newer membership must sort first — this is what getWorkspace's activeOrgId picks by default",
    );
  });
}
