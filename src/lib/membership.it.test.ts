import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { activeMembershipWhere } from "./membership";

// activeMembershipWhere must list exactly the people isMembershipActive lets
// in: the org's GDPR export used User.organizationId (the home org) and
// missed every member who joined by invite. Gated like the other DB suites.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";
const TAG = `mem-it-${Date.now()}`;
let orgId = "";
let homeOrgId = "";

before(async () => {
  if (!RUN_DB_IT) return;
  const org = await prisma.organization.create({ data: { name: `${TAG} org`, type: "ADVERTISER" } });
  const home = await prisma.organization.create({ data: { name: `${TAG} home`, type: "ADVERTISER" } });
  orgId = org.id;
  homeOrgId = home.id;
  const mk = async (key: string, m: { status?: "ACTIVE" | "EXPIRED" | "REVOKED"; expiresAt?: Date | null }) => {
    // Home org elsewhere: only the membership ties them to `org`.
    const user = await prisma.user.create({ data: { email: `${TAG}-${key}@example.test`, organizationId: homeOrgId } });
    await prisma.membership.create({
      data: { userId: user.id, organizationId: orgId, status: m.status ?? "ACTIVE", expiresAt: m.expiresAt ?? null },
    });
  };
  await mk("active", {});
  await mk("future", { expiresAt: new Date(Date.now() + 86_400_000) });
  await mk("expiredclock", { expiresAt: new Date(Date.now() - 1000) });
  await mk("expired", { status: "EXPIRED" });
  await mk("revoked", { status: "REVOKED" });
});

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, homeOrgId] } } });
});

test("activeMembershipWhere: active and unexpired members only, whatever their home org", { skip: !RUN_DB_IT }, async () => {
  const rows = await prisma.membership.findMany({
    where: { AND: [{ organizationId: orgId }, activeMembershipWhere()] },
    select: { user: { select: { email: true } } },
  });
  assert.deepEqual(
    rows.map((r) => r.user.email.replace(`${TAG}-`, "")).sort(),
    ["active@example.test", "future@example.test"],
  );
});
