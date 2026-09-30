import { test } from "node:test";
import assert from "node:assert/strict";
import { canActOnOrg, canCommitOnOrg } from "./scope";
import type { Scope } from "./scope";
import type { Workspace } from "./workspace";

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
  activeOrgId: "o1", scopeOrgIds: ["o1"], commitOrgIds: ["o1"],
  activeRole: "MEMBER" as const, activeCanCommit: true,
  ...over,
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
