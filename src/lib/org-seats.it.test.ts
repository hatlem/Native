import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { loadWorkspace, viewOrgIds, type Workspace } from "./workspace";
import { canActOnOrg, canCommitOnOrg, type Scope } from "./scope";
import {
  createAccountFromInvite,
  grantSeatFromInvite,
  hasActiveSeat,
  revokeSeat,
  type ClaimableInvite,
} from "./org-seats";
import { newInviteToken, expiryFromNow } from "./org-invite";
import type { MembershipRole } from "./membership";

// Team access end to end against the database: invite → claim → revoke →
// re-invite, and delegation expiry, through the same lib functions the server
// actions call (they only add auth + redirects). The regression this guards:
// a revoked member kept full access because the invite claim had pointed
// their account's home org at the org, and the workspace granted the home
// org unconditionally.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

const TAG = `seats-it-${Date.now()}`;
let orgId = "";
let adminId = "";
let requestId = "";
let quoteId = "";
let listId = "";
const createdUserIds: string[] = [];

function scopeFor(ws: Workspace | null): Scope {
  return { session: null, role: "BUYER", userId: ws?.userId, isDesk: false, isPublisher: false, workspace: ws };
}

async function invite(
  email: string,
  role: MembershipRole,
  opts: { canCommit?: boolean; delegationExpiresAt?: Date | null } = {},
): Promise<ClaimableInvite> {
  return prisma.orgInvite.create({
    data: {
      organizationId: orgId,
      email,
      role,
      canCommit: opts.canCommit ?? false,
      delegationExpiresAt: opts.delegationExpiresAt ?? null,
      token: newInviteToken(),
      expiresAt: expiryFromNow(),
      createdById: adminId,
    },
    select: {
      id: true,
      organizationId: true,
      email: true,
      role: true,
      canCommit: true,
      delegationExpiresAt: true,
      createdById: true,
    },
  });
}

// What a member can reach, read the way the pages read it: the overview
// queries (home / requests / lists) and the per-entity guards (plan, request
// and quote detail pages + the accept actions), plus whether they have an
// org to create plans in.
async function reach(userId: string, selectedOrgId: string | null = null, now = new Date()) {
  const ws = await loadWorkspace(userId, selectedOrgId, now);
  const scope = scopeFor(ws);
  const orgIds = ws ? viewOrgIds(ws) : [];
  const [requests, quotes, lists] = await Promise.all([
    prisma.request.count({ where: { id: requestId, organizationId: { in: orgIds } } }),
    prisma.quote.count({ where: { id: quoteId, request: { organizationId: { in: orgIds } } } }),
    prisma.savedList.count({ where: { id: listId, organizationId: { in: orgIds } } }),
  ]);
  return {
    ws,
    listedRequests: requests,
    listedQuotes: quotes,
    listedPlans: lists,
    canOpenOrgEntities: canActOnOrg(scope, orgId),
    canAccept: canCommitOnOrg(scope, orgId),
    canCreateInOrg: ws?.activeOrgId === orgId,
  };
}

function assertNoAccess(r: Awaited<ReturnType<typeof reach>>, why: string) {
  assert.equal(r.ws, null, `${why}: no workspace`);
  assert.equal(r.listedPlans, 0, `${why}: plans`);
  assert.equal(r.listedRequests, 0, `${why}: requests`);
  assert.equal(r.listedQuotes, 0, `${why}: quotes`);
  assert.equal(r.canOpenOrgEntities, false, `${why}: plan/request/quote detail`);
  assert.equal(r.canAccept, false, `${why}: accept`);
  assert.equal(r.canCreateInOrg, false, `${why}: create`);
}

before(async () => {
  if (!RUN_DB_IT) return;
  const org = await prisma.organization.create({
    data: { name: `Seats IT ${TAG}`, type: "ADVERTISER", marketCode: "NO" },
  });
  orgId = org.id;
  // The org creator, as signup makes them: home org + permanent ADMIN seat.
  const admin = await prisma.user.create({
    data: { email: `${TAG}-admin@example.test`, role: "BUYER", organizationId: orgId },
  });
  adminId = admin.id;
  createdUserIds.push(adminId);
  await prisma.membership.create({
    data: { userId: adminId, organizationId: orgId, role: "ADMIN", canCommit: true },
  });
  const plan = await prisma.plan.create({ data: { organizationId: orgId, name: "Seats IT plan" } });
  const request = await prisma.request.create({ data: { organizationId: orgId, planId: plan.id } });
  requestId = request.id;
  const quote = await prisma.quote.create({
    data: { requestId, status: "SENT", currency: "NOK", subtotal: 1000, vatPct: 25, total: 1250 },
  });
  quoteId = quote.id;
  listId = (await prisma.savedList.create({ data: { organizationId: orgId, name: "Seats IT list" } })).id;
});

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.quote.deleteMany({ where: { requestId } });
  await prisma.request.deleteMany({ where: { organizationId: orgId } });
  await prisma.plan.deleteMany({ where: { organizationId: orgId } });
  await prisma.savedList.deleteMany({ where: { organizationId: orgId } });
  await prisma.orgInvite.deleteMany({ where: { organizationId: orgId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.organization.delete({ where: { id: orgId } });
});

test("org creator reaches everything in their org", { skip: !RUN_DB_IT }, async () => {
  const r = await reach(adminId);
  assert.equal(r.ws?.activeOrgId, orgId);
  assert.equal(r.listedPlans, 1);
  assert.equal(r.listedRequests, 1);
  assert.equal(r.listedQuotes, 1);
  assert.equal(r.canAccept, true);
});

test("revoked member: no access to plans, requests, quotes or create — and re-invite restores it", { skip: !RUN_DB_IT }, async () => {
  const inv = await invite(`${TAG}-member@example.test`, "MEMBER");
  const memberId = await createAccountFromInvite(inv, { name: "Seats IT Member", passwordHash: null });
  createdUserIds.push(memberId);

  // The claim points the new account's home org at the org — the pointer
  // that used to grant access on its own.
  const user = await prisma.user.findUniqueOrThrow({ where: { id: memberId }, select: { organizationId: true } });
  assert.equal(user.organizationId, orgId);

  const before = await reach(memberId);
  assert.equal(before.canOpenOrgEntities, true);
  assert.equal(before.listedRequests, 1);
  assert.equal(before.canAccept, false, "MEMBER without ordering rights");
  assert.equal(before.canCreateInOrg, true);

  assert.deepEqual(await revokeSeat(orgId, memberId), { ok: true });
  assertNoAccess(await reach(memberId), "after revoke");
  // A CLIENT_COOKIE still naming the org changes nothing.
  assertNoAccess(await reach(memberId, orgId), "after revoke, stale org cookie");

  // Re-invite with different terms: the claim reactivates the old row with
  // the NEW invite's role and grant instead of failing on the unique index.
  assert.equal(await hasActiveSeat(memberId, orgId), false, "a revoked seat doesn't block the claim");
  const again = await invite(`${TAG}-member@example.test`, "MEMBER", { canCommit: true });
  await prisma.$transaction((tx) => grantSeatFromInvite(tx, again, memberId));

  const restored = await reach(memberId);
  assert.equal(restored.ws?.activeOrgId, orgId);
  assert.equal(restored.listedRequests, 1);
  assert.equal(restored.canAccept, true, "the re-invite's ordering rights apply");
  const seat = await prisma.membership.findUniqueOrThrow({
    where: { userId_organizationId: { userId: memberId, organizationId: orgId } },
  });
  assert.equal(seat.status, "ACTIVE");
  assert.equal(await prisma.membership.count({ where: { userId: memberId, organizationId: orgId } }), 1);
  const claimed = await prisma.orgInvite.findUniqueOrThrow({ where: { id: again.id } });
  assert.equal(claimed.claimedByUserId, memberId);
});

test("lapsed delegation: no access once the end date passes", { skip: !RUN_DB_IT }, async () => {
  const ends = new Date(Date.now() + 7 * 86_400_000);
  const inv = await invite(`${TAG}-deleg@example.test`, "RESTRICTED", { delegationExpiresAt: ends });
  const delegId = await createAccountFromInvite(inv, { name: "Seats IT Delegate", passwordHash: null });
  createdUserIds.push(delegId);

  assert.equal((await reach(delegId)).canOpenOrgEntities, true, "access while the delegation runs");
  // The day after the end date — lazily denied before any status sweep.
  assertNoAccess(await reach(delegId, null, new Date(ends.getTime() + 86_400_000)), "delegation lapsed");

  // …and once the stored row says EXPIRED too.
  await prisma.membership.updateMany({
    where: { userId: delegId, organizationId: orgId },
    data: { expiresAt: new Date(Date.now() - 1000), status: "EXPIRED" },
  });
  assertNoAccess(await reach(delegId), "delegation expired");
});

test("the last admin can't be revoked", { skip: !RUN_DB_IT }, async () => {
  assert.deepEqual(await revokeSeat(orgId, adminId), { ok: false, reason: "last_admin" });
  assert.equal(await hasActiveSeat(adminId, orgId), true);
});
