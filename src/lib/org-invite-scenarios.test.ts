import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeScopeOrgIds,
  resolveOrgMembership,
  type MembershipRow,
} from "./membership";
import { validateOrgClaim } from "./org-invite";

const NOW = new Date("2026-05-29T12:00:00Z");
const ORG = "org-maja";
const seat = (over: Partial<MembershipRow>): MembershipRow => ({
  userId: "sondre",
  organizationId: ORG,
  role: "MEMBER",
  canCommit: false,
  expiresAt: null,
  status: "ACTIVE",
  ...over,
});

// Mirrors the canCommitOnOrg resolution path for a non-agency member.
function canCommit(rows: MembershipRow[], orgId: string, now: Date): boolean {
  const m = resolveOrgMembership(rows, orgId, now);
  return !!m?.canCommit;
}

test("Scenario A — Sondre joins as Member with commit, can submit", () => {
  const claim = validateOrgClaim(
    { email: "sondre@x.com", expiresAt: new Date("2026-12-01"), claimedAt: null },
    { authedEmail: null, isAlreadyMember: false },
    NOW,
  );
  assert.deepEqual(claim, { ok: true, mode: "new" });
  const rows = [seat({ canCommit: true })];
  assert.ok(activeScopeOrgIds(rows, NOW).includes(ORG));
  assert.equal(canCommit(rows, ORG, NOW), true);
});

test("Scenario B — Sondre = Member, canCommit false: sees all, cannot accept quote", () => {
  const rows = [seat({ canCommit: false })];
  assert.ok(activeScopeOrgIds(rows, NOW).includes(ORG)); // full read access
  assert.equal(canCommit(rows, ORG, NOW), false);         // Maja must gate the quote
});

test("Scenario C — Andreas = Restricted delegation auto-de-escalates on 2026-10-05", () => {
  const before = new Date("2026-09-01T00:00:00Z");
  const after = new Date("2026-10-06T00:00:00Z");
  const rows: MembershipRow[] = [
    {
      userId: "andreas",
      organizationId: ORG,
      role: "RESTRICTED",
      canCommit: false,
      expiresAt: new Date("2026-10-05T00:00:00Z"),
      status: "ACTIVE",
    },
  ];
  // Before the date: scoped access.
  assert.ok(activeScopeOrgIds(rows, before).includes(ORG));
  assert.equal(resolveOrgMembership(rows, ORG, before)?.role, "RESTRICTED");
  // After the date: ZERO access at request time, regardless of the cron.
  assert.deepEqual(activeScopeOrgIds(rows, after), []);
  assert.equal(resolveOrgMembership(rows, ORG, after), null);
  assert.equal(canCommit(rows, ORG, after), false);
});

test("Scenario D — publisher path is independent of memberships (regression guard)", () => {
  // A user with no org memberships gets no org scope; publisher access is a
  // separate axis (user.role === PUBLISHER), untouched here.
  assert.deepEqual(activeScopeOrgIds([], NOW), []);
});

test("re-claiming an already-claimed invite is refused (idempotency)", () => {
  const v = validateOrgClaim(
    { email: "sondre@x.com", expiresAt: new Date("2026-12-01"), claimedAt: NOW },
    { authedEmail: "sondre@x.com", isAlreadyMember: false },
    NOW,
  );
  assert.deepEqual(v, { ok: false, reason: "claimed" });
});
