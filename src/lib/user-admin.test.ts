import { test } from "node:test";
import assert from "node:assert/strict";
import type { UserRole } from "@prisma/client";
import {
  canChangeRole,
  canDeactivateSelf,
  canRebind,
  canSetDeactivated,
  isActiveSuperadmin,
  type AdminUserRow,
} from "./user-admin";

function user(
  id: string,
  role: UserRole = "BUYER",
  deactivatedAt: Date | null = null,
): AdminUserRow {
  return { id, role, deactivatedAt };
}

const ADMIN_A = user("a", "SUPERADMIN");
const ADMIN_B = user("b", "SUPERADMIN");
const ADMIN_OFF = user("c", "SUPERADMIN", new Date("2026-01-01"));
const BUYER = user("z", "BUYER");

test("a deactivated super-admin is not an active one", () => {
  assert.equal(isActiveSuperadmin(ADMIN_A), true);
  assert.equal(isActiveSuperadmin(ADMIN_OFF), false);
  assert.equal(isActiveSuperadmin(BUYER), false);
});

test("canChangeRole: the console refuses to act on the actor's own account", () => {
  const v = canChangeRole("a", ADMIN_A, "BUYER", [ADMIN_A, ADMIN_B]);
  assert.deepEqual(v, { ok: false, reason: "self" });
});

test("canChangeRole: demoting the last active super-admin is refused", () => {
  const v = canChangeRole("x", ADMIN_A, "DESK", [ADMIN_A, ADMIN_OFF]);
  assert.deepEqual(v, { ok: false, reason: "last_superadmin" });
});

test("canChangeRole: demoting a super-admin is fine while another active one remains", () => {
  assert.deepEqual(canChangeRole("x", ADMIN_A, "DESK", [ADMIN_A, ADMIN_B]), {
    ok: true,
  });
});

test("canChangeRole: promoting the last super-admin to SUPERADMIN again is not a demotion", () => {
  assert.deepEqual(
    canChangeRole("x", ADMIN_A, "SUPERADMIN", [ADMIN_A, ADMIN_OFF]),
    { ok: true },
  );
});

test("canChangeRole: a missing target reports not_found rather than throwing", () => {
  assert.deepEqual(canChangeRole("x", null, "DESK", []), {
    ok: false,
    reason: "not_found",
  });
});

test("canSetDeactivated: reactivation is always allowed, even for the last super-admin", () => {
  assert.deepEqual(canSetDeactivated("x", ADMIN_OFF, false, [ADMIN_OFF]), {
    ok: true,
  });
});

test("canSetDeactivated: deactivating the last active super-admin is refused", () => {
  assert.deepEqual(canSetDeactivated("x", ADMIN_A, true, [ADMIN_A, ADMIN_OFF]), {
    ok: false,
    reason: "last_superadmin",
  });
});

test("canSetDeactivated: deactivating yourself from the console is refused", () => {
  assert.deepEqual(canSetDeactivated("a", ADMIN_A, true, [ADMIN_A, ADMIN_B]), {
    ok: false,
    reason: "self",
  });
});

test("canSetDeactivated: an ordinary user can be deactivated regardless of admin counts", () => {
  assert.deepEqual(canSetDeactivated("a", BUYER, true, [ADMIN_A]), { ok: true });
});

test("canRebind: self is refused, anyone else is allowed", () => {
  assert.deepEqual(canRebind("a", ADMIN_A), { ok: false, reason: "self" });
  assert.deepEqual(canRebind("a", BUYER), { ok: true });
  assert.deepEqual(canRebind("a", null), { ok: false, reason: "not_found" });
});

test("canDeactivateSelf: the last active super-admin can't off-board themselves", () => {
  assert.deepEqual(canDeactivateSelf(ADMIN_A, [ADMIN_A, ADMIN_OFF]), {
    ok: false,
    reason: "last_superadmin",
  });
});

test("canDeactivateSelf: a super-admin with an active peer may leave", () => {
  assert.deepEqual(canDeactivateSelf(ADMIN_A, [ADMIN_A, ADMIN_B]), { ok: true });
});

test("canDeactivateSelf: an ordinary user may always leave", () => {
  assert.deepEqual(canDeactivateSelf(BUYER, [ADMIN_A]), { ok: true });
});
