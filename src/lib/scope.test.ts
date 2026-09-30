import { test } from "node:test";
import assert from "node:assert/strict";
import { canActOnOrg, canCommitOnOrg, canEditOnOrg } from "./scope";
import type { Scope } from "./scope";
import { resolveWorkspace, type Workspace } from "./workspace";

const base = (over: Partial<Scope>): Scope => ({
  session: null,
  role: undefined,
  userId: "u1",
  isDesk: false,
  isPublisher: false,
  workspace: null,
  ...over,
});

const ws = (over: Partial<Workspace>): Workspace => ({
  userId: "u1", isAgency: false, agencyOrgId: null, homeOrgId: "o1", homeRole: "MEMBER",
  activeOrgId: "o1", scopeOrgIds: ["o1"], editOrgIds: ["o1"], commitOrgIds: ["o1"],
  activeRole: "MEMBER" as const, activeCanCommit: true, activeCanEdit: true,
  ...over,
});

// ─── canEditOnOrg: the one write guard (view-only seats) ─────────────────────

test("desk may always edit", () => {
  assert.equal(canEditOnOrg(base({ isDesk: true }), "anything"), true);
});
test("a member or admin seat may edit its org", () => {
  assert.equal(canEditOnOrg(base({ workspace: ws({}) }), "o1"), true);
});
test("no workspace → cannot edit (signed out, revoked or lapsed)", () => {
  assert.equal(canEditOnOrg(base({ workspace: null }), "o1"), false);
});
test("an org outside scope can never be edited", () => {
  assert.equal(canEditOnOrg(base({ workspace: ws({}) }), "o2"), false);
});
test("a RESTRICTED seat reads the org but may not edit or commit on it", () => {
  // Resolved through the real access model, not a hand-built workspace, so
  // the helper and resolveWorkspace can't drift apart.
  const viewOnly = resolveWorkspace({
    userId: "u1",
    homeOrg: { id: "o1", type: "ADVERTISER" },
    memberships: [
      { userId: "u1", organizationId: "o1", role: "RESTRICTED", canCommit: false, expiresAt: null, status: "ACTIVE" },
    ],
    agencyClientIds: [],
    selectedOrgId: null,
    now: new Date(),
  });
  const scope = base({ workspace: viewOnly });
  assert.equal(canActOnOrg(scope, "o1"), true, "view-only still reads");
  assert.equal(canEditOnOrg(scope, "o1"), false);
  assert.equal(canCommitOnOrg(scope, "o1"), false);
});
test("edit follows the seat in THAT org, not which org is switched to", () => {
  const multi = ws({ activeOrgId: "o1", scopeOrgIds: ["o1", "o2"], editOrgIds: ["o2"], activeCanEdit: false });
  assert.equal(canEditOnOrg(base({ workspace: multi }), "o2"), true);
  assert.equal(canEditOnOrg(base({ workspace: multi }), "o1"), false);
});

test("desk can always commit", () => {
  assert.equal(canCommitOnOrg(base({ isDesk: true }), "o1"), true);
});
test("member with canCommit on the org may commit", () => {
  assert.equal(canCommitOnOrg(base({ workspace: ws({}) }), "o1"), true);
});
test("member without canCommit may NOT commit (Scenario B)", () => {
  assert.equal(
    canCommitOnOrg(base({ workspace: ws({ commitOrgIds: [], activeCanCommit: false }) }), "o1"),
    false,
  );
});
test("commit follows the seat in THAT org, not which org is switched to", () => {
  // Commit in o2 but working in o1: accepting o2's quote from a link is fine…
  const multi = ws({ activeOrgId: "o1", scopeOrgIds: ["o1", "o2"], commitOrgIds: ["o2"], activeCanCommit: false });
  assert.equal(canCommitOnOrg(base({ workspace: multi }), "o2"), true);
  // …and the switched-to org grants nothing it doesn't have.
  assert.equal(canCommitOnOrg(base({ workspace: multi }), "o1"), false);
});
test("an org outside scope can never be committed on", () => {
  assert.equal(canCommitOnOrg(base({ workspace: ws({}) }), "o2"), false);
});
test("no workspace → cannot act or commit (revoked / lapsed member)", () => {
  assert.equal(canCommitOnOrg(base({ workspace: null }), "o1"), false);
  assert.equal(canActOnOrg(base({ workspace: null }), "o1"), false);
});
test("agency may commit on a client org in scope (no membership required)", () => {
  const agency = ws({
    isAgency: true, agencyOrgId: "ag1", activeOrgId: "client1",
    scopeOrgIds: ["ag1", "client1"], commitOrgIds: ["ag1", "client1"],
    activeRole: null, activeCanCommit: false,
  });
  assert.equal(canCommitOnOrg(base({ workspace: agency }), "client1"), true);
  assert.equal(canCommitOnOrg(base({ workspace: agency }), "other"), false);
});
