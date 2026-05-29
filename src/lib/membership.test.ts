import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isMembershipActive,
  activeScopeOrgIds,
  resolveOrgMembership,
  wouldRemoveLastAdmin,
  type MembershipRow,
} from "./membership";

const NOW = new Date("2026-05-29T12:00:00Z");
const row = (over: Partial<MembershipRow>): MembershipRow => ({
  userId: "u1",
  organizationId: "o1",
  role: "MEMBER",
  canCommit: false,
  expiresAt: null,
  status: "ACTIVE",
  ...over,
});

test("permanent active membership is active", () => {
  assert.equal(isMembershipActive(row({}), NOW), true);
});

test("future-dated delegation is active", () => {
  assert.equal(
    isMembershipActive(row({ expiresAt: new Date("2026-10-05T00:00:00Z") }), NOW),
    true,
  );
});

test("past-dated delegation is NOT active (the security boundary)", () => {
  assert.equal(
    isMembershipActive(row({ expiresAt: new Date("2026-01-01T00:00:00Z") }), NOW),
    false,
  );
});

test("REVOKED / EXPIRED status is never active", () => {
  assert.equal(isMembershipActive(row({ status: "REVOKED" }), NOW), false);
  assert.equal(isMembershipActive(row({ status: "EXPIRED" }), NOW), false);
});

test("activeScopeOrgIds unions active orgs and excludes expired", () => {
  const ids = activeScopeOrgIds(
    [
      row({ organizationId: "o1" }),
      row({ organizationId: "o2", expiresAt: new Date("2026-10-05T00:00:00Z") }),
      row({ organizationId: "o3", expiresAt: new Date("2026-01-01T00:00:00Z") }),
      row({ organizationId: "o4", status: "REVOKED" }),
    ],
    NOW,
  );
  assert.deepEqual(ids.sort(), ["o1", "o2"]);
});

test("resolveOrgMembership returns the active row for an org, else null", () => {
  const ms = [row({ organizationId: "o1", role: "ADMIN", canCommit: true })];
  assert.equal(resolveOrgMembership(ms, "o1", NOW)?.role, "ADMIN");
  assert.equal(resolveOrgMembership(ms, "missing", NOW), null);
});

test("resolveOrgMembership ignores an expired row for that org", () => {
  const ms = [row({ organizationId: "o1", expiresAt: new Date("2026-01-01T00:00:00Z") })];
  assert.equal(resolveOrgMembership(ms, "o1", NOW), null);
});

test("wouldRemoveLastAdmin true when target is the only active admin", () => {
  const ms = [
    row({ userId: "a", role: "ADMIN" }),
    row({ userId: "b", role: "MEMBER" }),
  ];
  assert.equal(wouldRemoveLastAdmin(ms, "a", NOW), true);
});

test("wouldRemoveLastAdmin false when another active admin remains", () => {
  const ms = [
    row({ userId: "a", role: "ADMIN" }),
    row({ userId: "b", role: "ADMIN" }),
  ];
  assert.equal(wouldRemoveLastAdmin(ms, "a", NOW), false);
});

test("wouldRemoveLastAdmin ignores an expired admin when counting", () => {
  const ms = [
    row({ userId: "a", role: "ADMIN" }),
    row({ userId: "b", role: "ADMIN", expiresAt: new Date("2026-01-01T00:00:00Z") }),
  ];
  assert.equal(wouldRemoveLastAdmin(ms, "a", NOW), true);
});
