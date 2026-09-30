import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWorkspace, viewOrgIds, companySeat, type WorkspaceInputs } from "./workspace";
import type { MembershipRow } from "./membership";

// The access model (lib/workspace resolveWorkspace): an advertiser org is
// reachable only through an ACTIVE seat. The home org pointer on the user row
// only picks the default. See workspace.it.test.ts for the same rules driven
// through the real invite/claim/revoke writes.

const NOW = new Date("2026-09-30T12:00:00Z");
const seat = (organizationId: string, over: Partial<MembershipRow> = {}): MembershipRow => ({
  userId: "u1",
  organizationId,
  role: "MEMBER",
  canCommit: false,
  expiresAt: null,
  status: "ACTIVE",
  ...over,
});
const input = (over: Partial<WorkspaceInputs>): WorkspaceInputs => ({
  userId: "u1",
  homeOrg: { id: "home", type: "ADVERTISER" },
  memberships: [],
  agencyClientIds: [],
  selectedOrgId: null,
  now: NOW,
  ...over,
});

test("org creator: the home org with its ADMIN seat is the active org", () => {
  const ws = resolveWorkspace(input({ memberships: [seat("home", { role: "ADMIN", canCommit: true })] }))!;
  assert.equal(ws.activeOrgId, "home");
  assert.equal(ws.homeOrgId, "home");
  assert.equal(ws.homeRole, "ADMIN");
  assert.deepEqual(ws.scopeOrgIds, ["home"]);
  assert.deepEqual(ws.commitOrgIds, ["home"]);
});

test("REVOKED seat in the home org grants nothing (the invite-claim leak)", () => {
  // An invite claim points a brand-new account's home org at the inviting
  // org. Revoking the seat used to leave that pointer granting full access.
  assert.equal(resolveWorkspace(input({ memberships: [seat("home", { status: "REVOKED" })] })), null);
});

test("a lapsed delegation grants nothing, even before the status is reconciled", () => {
  const lapsed = seat("home", { expiresAt: new Date(NOW.getTime() - 1000) });
  assert.equal(resolveWorkspace(input({ memberships: [lapsed] })), null);
  const expired = seat("home", { status: "EXPIRED" });
  assert.equal(resolveWorkspace(input({ memberships: [expired] })), null);
});

test("a home org with no seat at all grants nothing", () => {
  assert.equal(resolveWorkspace(input({ memberships: [] })), null);
});

test("revoked from the home org, still active elsewhere: only the other org, no home", () => {
  const ws = resolveWorkspace(
    input({ memberships: [seat("home", { status: "REVOKED" }), seat("other")], selectedOrgId: "home" }),
  )!;
  assert.deepEqual(ws.scopeOrgIds, ["other"]);
  assert.equal(ws.activeOrgId, "other", "a stale cookie naming the lost org must not select it");
  assert.equal(ws.homeOrgId, null, "favorites sharing must not keep pointing at the lost team");
});

test("multi-org member: the cookie selects among seats, the home org is the default", () => {
  const memberships = [seat("second", { role: "MEMBER" }), seat("home", { role: "ADMIN", canCommit: true })];
  const byDefault = resolveWorkspace(input({ memberships }))!;
  assert.equal(byDefault.activeOrgId, "home");
  const switched = resolveWorkspace(input({ memberships, selectedOrgId: "second" }))!;
  assert.equal(switched.activeOrgId, "second");
  assert.equal(switched.activeRole, "MEMBER");
  assert.equal(switched.activeCanCommit, false);
  assert.deepEqual(switched.commitOrgIds, ["home"], "commit authority stays with the seat that has it");
  assert.deepEqual(viewOrgIds(switched), ["second"], "overviews show the switched-to org only");
  assert.deepEqual(companySeat(switched), { orgId: "second", isAdmin: false });
});

test("a forged cookie for an org without a seat falls back", () => {
  const ws = resolveWorkspace(input({ memberships: [seat("home")], selectedOrgId: "someone-else" }))!;
  assert.equal(ws.activeOrgId, "home");
});

test("membership-only user (no home org) works from their seats", () => {
  const ws = resolveWorkspace(input({ homeOrg: null, memberships: [seat("a")] }))!;
  assert.equal(ws.activeOrgId, "a");
  assert.equal(ws.homeOrgId, null);
});

test("agency: reach over clients comes from parentOrgId, unchanged", () => {
  const agency = resolveWorkspace(
    input({
      homeOrg: { id: "ag", type: "AGENCY" },
      memberships: [seat("ag", { role: "ADMIN", canCommit: true })],
      agencyClientIds: ["c1", "c2"],
      selectedOrgId: "c2",
    }),
  )!;
  assert.equal(agency.isAgency, true);
  assert.equal(agency.activeOrgId, "c2");
  assert.deepEqual(agency.scopeOrgIds, ["ag", "c1", "c2"]);
  assert.deepEqual(agency.commitOrgIds, agency.scopeOrgIds);
  assert.deepEqual(viewOrgIds(agency), agency.scopeOrgIds, "agency overviews span every client");
  assert.deepEqual(companySeat(agency), { orgId: "ag", isAdmin: true }, "an agency edits its own company");
});

test("agency without a client selected has no active org", () => {
  const agency = resolveWorkspace(
    input({ homeOrg: { id: "ag", type: "AGENCY" }, agencyClientIds: ["c1"], selectedOrgId: "not-a-client" }),
  )!;
  assert.equal(agency.activeOrgId, null);
});

// ─── View-only (RESTRICTED) seats ─────────────────────────────────────────────

test("a RESTRICTED seat reads its org but may not change or commit anything", () => {
  // canCommit=true models a row written before the DB CHECK existed: the role
  // alone must still deny the grant.
  const ws = resolveWorkspace(input({ memberships: [seat("home", { role: "RESTRICTED", canCommit: true })] }))!;
  assert.deepEqual(ws.scopeOrgIds, ["home"], "view-only still sees the org");
  assert.deepEqual(ws.editOrgIds, []);
  assert.deepEqual(ws.commitOrgIds, []);
  assert.equal(ws.activeCanEdit, false);
  assert.equal(ws.activeCanCommit, false);
});

test("edit rights follow the seat in each org, not the switched-to org", () => {
  const memberships = [seat("viewer", { role: "RESTRICTED" }), seat("home", { role: "MEMBER" })];
  const inHome = resolveWorkspace(input({ memberships }))!;
  assert.deepEqual(inHome.editOrgIds, ["home"]);
  assert.equal(inHome.activeCanEdit, true);
  const inViewer = resolveWorkspace(input({ memberships, selectedOrgId: "viewer" }))!;
  assert.equal(inViewer.activeOrgId, "viewer");
  assert.equal(inViewer.activeCanEdit, false);
  assert.deepEqual(inViewer.editOrgIds, ["home"], "switching orgs grants nothing the seat doesn't have");
});

test("members and admins may edit; edit rights never exceed read scope", () => {
  const ws = resolveWorkspace(
    input({ memberships: [seat("home", { role: "ADMIN", canCommit: true }), seat("b", { role: "MEMBER" })] }),
  )!;
  assert.deepEqual([...ws.editOrgIds].sort(), ["b", "home"]);
  for (const id of ws.editOrgIds) assert.ok(ws.scopeOrgIds.includes(id));
  for (const id of ws.commitOrgIds) assert.ok(ws.editOrgIds.includes(id));
});

test("agency: a view-only seat in the agency makes its whole client reach read-only", () => {
  const agency = resolveWorkspace(
    input({
      homeOrg: { id: "ag", type: "AGENCY" },
      memberships: [seat("ag", { role: "RESTRICTED" })],
      agencyClientIds: ["c1"],
      selectedOrgId: "c1",
    }),
  )!;
  assert.deepEqual(agency.scopeOrgIds, ["ag", "c1"], "still sees every client");
  assert.deepEqual(agency.editOrgIds, []);
  assert.deepEqual(agency.commitOrgIds, []);
  assert.equal(agency.activeCanEdit, false);
});

test("agency: a full agency seat (or none) keeps full control over its clients", () => {
  const agency = resolveWorkspace(
    input({ homeOrg: { id: "ag", type: "AGENCY" }, agencyClientIds: ["c1"], selectedOrgId: "c1" }),
  )!;
  assert.deepEqual(agency.editOrgIds, agency.scopeOrgIds);
  assert.equal(agency.activeCanEdit, true);
});
