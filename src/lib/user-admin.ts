// Guards for the super-admin user console (/desk/users) and for
// self-service deactivation (/account).
//
// Pure functions: the caller loads the rows and passes `now`, this module
// says yes/no/why. Same split as @/lib/membership's wouldRemoveLastAdmin —
// the interesting failure modes (locking the platform out of its own admin
// console, a super-admin demoting themselves by misclick) are exactly the
// ones you cannot exercise against a live database in a unit test.

import type { UserRole } from "@prisma/client";

// Every field the guards below need. Deliberately narrower than the Prisma
// row so a caller can't accidentally make a decision on stale relations.
export type AdminUserRow = {
  id: string;
  role: UserRole;
  deactivatedAt: Date | null;
};

export type AdminVerdict = { ok: true } | { ok: false; reason: AdminDenyReason };

export type AdminDenyReason =
  | "self" // acting on your own account through the admin console
  | "last_superadmin" // would leave the platform with zero active super-admins
  | "not_found";

const OK: AdminVerdict = { ok: true };

// An account only counts towards "we still have an admin" when it is BOTH
// SUPERADMIN and not deactivated — a deactivated super-admin cannot sign in,
// so it is not a way back in.
export function isActiveSuperadmin(user: AdminUserRow): boolean {
  return user.role === "SUPERADMIN" && user.deactivatedAt === null;
}

function remainingSuperadmins(
  users: AdminUserRow[],
  excludingUserId: string,
): number {
  return users.filter((u) => u.id !== excludingUserId && isActiveSuperadmin(u))
    .length;
}

// Changing a platform role. Refused when the actor targets themselves — a
// super-admin who demotes their own account loses the console that would let
// them undo it — and when it would remove the last way into that console.
export function canChangeRole(
  actorId: string,
  target: AdminUserRow | null | undefined,
  nextRole: UserRole,
  allUsers: AdminUserRow[],
): AdminVerdict {
  if (!target) return { ok: false, reason: "not_found" };
  if (target.id === actorId) return { ok: false, reason: "self" };
  if (
    isActiveSuperadmin(target) &&
    nextRole !== "SUPERADMIN" &&
    remainingSuperadmins(allUsers, target.id) === 0
  ) {
    return { ok: false, reason: "last_superadmin" };
  }
  return OK;
}

// Deactivating (or reactivating) from the admin console. Reactivation is
// always safe; deactivation carries the same two guards as a role change.
export function canSetDeactivated(
  actorId: string,
  target: AdminUserRow | null | undefined,
  deactivate: boolean,
  allUsers: AdminUserRow[],
): AdminVerdict {
  if (!target) return { ok: false, reason: "not_found" };
  if (!deactivate) return OK;
  if (target.id === actorId) return { ok: false, reason: "self" };
  if (
    isActiveSuperadmin(target) &&
    remainingSuperadmins(allUsers, target.id) === 0
  ) {
    return { ok: false, reason: "last_superadmin" };
  }
  return OK;
}

// Re-binding a user to another organization / publisher. No last-admin
// dimension (org membership is separate from the platform role) but the
// self-guard still applies: moving your own account out from under its org
// mid-session is a support ticket, not a feature.
export function canRebind(
  actorId: string,
  target: AdminUserRow | null | undefined,
): AdminVerdict {
  if (!target) return { ok: false, reason: "not_found" };
  if (target.id === actorId) return { ok: false, reason: "self" };
  return OK;
}

// Self-service deactivation from /account. The platform-level guard is the
// mirror of the console one: the last active super-admin cannot walk out and
// leave nobody holding the keys. Org-level "last admin of my org" is checked
// separately by the caller against @/lib/membership, because that needs the
// membership rows this module deliberately doesn't take.
export function canDeactivateSelf(
  actor: AdminUserRow,
  allUsers: AdminUserRow[],
): AdminVerdict {
  if (
    isActiveSuperadmin(actor) &&
    remainingSuperadmins(allUsers, actor.id) === 0
  ) {
    return { ok: false, reason: "last_superadmin" };
  }
  return OK;
}
