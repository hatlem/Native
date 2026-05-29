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
