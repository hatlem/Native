import { test } from "node:test";
import assert from "node:assert/strict";
import { canCommitOnOrg } from "./scope";
import type { Scope } from "./scope";

const base = (over: Partial<Scope>): Scope => ({
  session: null,
  role: undefined,
  userId: "u1",
  isDesk: false,
  isPublisher: false,
  workspace: null,
  ...over,
});

const ws = (over: Partial<NonNullable<Scope["workspace"]>>) => ({
  userId: "u1", isAgency: false, agencyOrgId: null,
  activeOrgId: "o1", scopeOrgIds: ["o1"], activeRole: "MEMBER" as const, activeCanCommit: true,
  ...over,
});

test("desk can always commit", () => {
  assert.equal(canCommitOnOrg(base({ isDesk: true }), "o1"), true);
});
test("member with canCommit on active org may commit", () => {
  assert.equal(canCommitOnOrg(base({ workspace: ws({ activeCanCommit: true }) }), "o1"), true);
});
test("member without canCommit may NOT commit (Scenario B)", () => {
  assert.equal(canCommitOnOrg(base({ workspace: ws({ activeCanCommit: false }) }), "o1"), false);
});
test("cannot commit on an org that is not the active org", () => {
  assert.equal(canCommitOnOrg(base({ workspace: ws({ activeOrgId: "o1", scopeOrgIds: ["o1","o2"], activeCanCommit: true }) }), "o2"), false);
});
test("no workspace → cannot commit", () => {
  assert.equal(canCommitOnOrg(base({ workspace: null }), "o1"), false);
});
test("agency may commit on a client org in scope (no membership required)", () => {
  assert.equal(
    canCommitOnOrg(
      base({ workspace: ws({ isAgency: true, agencyOrgId: "ag1", activeOrgId: "client1", scopeOrgIds: ["ag1", "client1"], activeRole: null, activeCanCommit: false }) }),
      "client1",
    ),
    true,
  );
});
test("agency may NOT commit on an org outside its scope", () => {
  assert.equal(
    canCommitOnOrg(
      base({ workspace: ws({ isAgency: true, agencyOrgId: "ag1", activeOrgId: "client1", scopeOrgIds: ["ag1", "client1"], activeRole: null, activeCanCommit: false }) }),
      "other",
    ),
    false,
  );
});
