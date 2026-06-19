import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  type MembershipRole,
  type MembershipRow,
  activeScopeOrgIds,
  resolveOrgMembership,
} from "@/lib/membership";

export const CLIENT_COOKIE = "nativespin_client";

export type Workspace = {
  userId: string;
  isAgency: boolean;
  agencyOrgId: string | null;
  // The user's OWN employer org (User.organization). For an agency this is the
  // agency itself; for an advertiser, their own org; null for membership-only
  // (no home org) users. Stable across client switching — use this, not
  // activeOrgId, for "my team" scoping like favorites sharing.
  homeOrgId: string | null;
  // The org buyer actions operate on. Advertiser = own org; agency =
  // the selected client (null until one is picked).
  activeOrgId: string | null;
  // Org ids this user may read: own/active org plus, for an agency, all
  // of its client orgs. Used for request/quote/report scoping.
  scopeOrgIds: string[];
  // Resolved authority for activeOrgId from the membership row (null when there
  // is no active membership for the active org, e.g. pure agency path).
  activeRole: MembershipRole | null;
  activeCanCommit: boolean;
};

async function loadMemberships(userId: string): Promise<MembershipRow[]> {
  const rows = await prisma.membership.findMany({
    where: { userId },
    select: {
      userId: true,
      organizationId: true,
      role: true,
      canCommit: true,
      expiresAt: true,
      status: true,
    },
  });
  return rows as MembershipRow[];
}

// Resolve the acting workspace for a signed-in user. Returns null when the
// user has no organization (e.g. desk/publisher accounts).
export async function getWorkspace(
  userId: string | undefined,
): Promise<Workspace | null> {
  if (!userId) return null;

  const [user, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { organization: { select: { id: true, type: true } } },
    }),
    loadMemberships(userId),
  ]);

  const now = new Date();
  const membershipOrgIds = activeScopeOrgIds(memberships, now);

  // Opportunistic, on-action reconciliation (no cron/worker): once a membership
  // crosses its expiry, flip its stored status so audit/reporting stays accurate.
  // This is bookkeeping only — access is already denied lazily by
  // activeScopeOrgIds/resolveOrgMembership (which test expiresAt), and the Team UI
  // derives "Expired" from isMembershipActive. Fire-and-forget; scoped to this user.
  const hasNewlyExpired = memberships.some(
    (m) =>
      m.status === "ACTIVE" &&
      m.expiresAt !== null &&
      m.expiresAt.getTime() <= now.getTime(),
  );
  if (hasNewlyExpired) {
    void prisma.membership
      .updateMany({
        where: { userId, status: "ACTIVE", expiresAt: { not: null, lte: now } },
        data: { status: "EXPIRED" },
      })
      .catch((err) => console.error("membership.reconcile_failed", { userId, err }));
  }

  const org = user?.organization;

  if (!org) {
    // No home org — build a workspace from memberships alone if possible.
    if (membershipOrgIds.length > 0) {
      const store = await cookies();
      const selected = store.get(CLIENT_COOKIE)?.value ?? null;
      const activeOrgId =
        selected && membershipOrgIds.includes(selected)
          ? selected
          : membershipOrgIds[0];
      const active = resolveOrgMembership(memberships, activeOrgId, now);
      return {
        userId,
        isAgency: false,
        agencyOrgId: null,
        homeOrgId: null,
        activeOrgId,
        scopeOrgIds: membershipOrgIds,
        activeRole: active?.role ?? null,
        activeCanCommit: active?.canCommit ?? false,
      };
    }
    return null;
  }

  if (org.type !== "AGENCY") {
    const homeOrgId = org.id;
    const store = await cookies();
    const selected = store.get(CLIENT_COOKIE)?.value ?? null;
    const activeOrgId =
      selected && membershipOrgIds.includes(selected) ? selected : homeOrgId;
    const active = resolveOrgMembership(memberships, activeOrgId, now);
    return {
      userId,
      isAgency: false,
      agencyOrgId: null,
      homeOrgId,
      activeOrgId,
      scopeOrgIds: Array.from(new Set([homeOrgId, ...membershipOrgIds])),
      activeRole: active?.role ?? null,
      activeCanCommit: active?.canCommit ?? false,
    };
  }

  const clients = await prisma.organization.findMany({
    where: { parentOrgId: org.id },
    select: { id: true },
  });
  const clientIds = clients.map((c) => c.id);
  const store = await cookies();
  const selected = store.get(CLIENT_COOKIE)?.value ?? null;
  const activeOrgId =
    selected && clientIds.includes(selected) ? selected : null;

  const active = activeOrgId
    ? resolveOrgMembership(memberships, activeOrgId, now)
    : null;

  return {
    userId,
    isAgency: true,
    agencyOrgId: org.id,
    homeOrgId: org.id,
    activeOrgId,
    scopeOrgIds: Array.from(new Set([org.id, ...clientIds, ...membershipOrgIds])),
    activeRole: active?.role ?? null,
    activeCanCommit: active?.canCommit ?? false,
  };
}
