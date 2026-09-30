export type MembershipRole = "ADMIN" | "MEMBER" | "RESTRICTED";
export type MembershipStatus = "ACTIVE" | "EXPIRED" | "REVOKED";

export type MembershipRow = {
  userId: string;
  organizationId: string;
  role: MembershipRole;
  canCommit: boolean;
  expiresAt: Date | null;
  status: MembershipStatus;
};

/** The real security boundary: a row grants nothing once it is not ACTIVE or past its expiry. */
export function isMembershipActive(m: MembershipRow, now: Date = new Date()): boolean {
  if (m.status !== "ACTIVE") return false;
  if (m.expiresAt && m.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

export function activeScopeOrgIds(
  memberships: MembershipRow[],
  now: Date = new Date(),
): string[] {
  return Array.from(
    new Set(
      memberships.filter((m) => isMembershipActive(m, now)).map((m) => m.organizationId),
    ),
  );
}

export function resolveOrgMembership(
  memberships: MembershipRow[],
  organizationId: string,
  now: Date = new Date(),
): MembershipRow | null {
  return (
    memberships.find(
      (m) => m.organizationId === organizationId && isMembershipActive(m, now),
    ) ?? null
  );
}

/**
 * True if demoting/removing `targetUserId` would leave the org with zero active admins.
 * `orgMemberships` must be all memberships for the single target org.
 */
export function wouldRemoveLastAdmin(
  orgMemberships: MembershipRow[],
  targetUserId: string,
  now: Date = new Date(),
): boolean {
  const activeAdmins = orgMemberships.filter(
    (m) => isMembershipActive(m, now) && m.role === "ADMIN",
  );
  return activeAdmins.length === 1 && activeAdmins[0].userId === targetUserId;
}

/**
 * May a seat with this role change anything in its org? RESTRICTED is a
 * view-only seat: it reads the org's plans, requests, quotes, orders, reports,
 * articles and invoices, and changes none of them. Every write authority
 * (lib/workspace editOrgIds, and through it lib/scope canEditOnOrg) derives
 * from this one rule.
 */
export function roleCanEdit(role: MembershipRole): boolean {
  return role !== "RESTRICTED";
}

/**
 * Commit authority (accept quotes, place orders) for a seat. An ADMIN always
 * has it: an admin can grant it to anyone, themselves included, so an admin
 * without it was never a real restriction, only a wall the first time they
 * tried to accept a quote. A view-only (RESTRICTED) seat never has it, whatever
 * was asked for. Enforced in the database too (CHECK constraints on Membership
 * and OrgInvite), so every writer must route through this.
 */
export function commitGrantFor(role: MembershipRole, requested: boolean): boolean {
  if (!roleCanEdit(role)) return false;
  return role === "ADMIN" || requested;
}
