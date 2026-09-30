import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  type MembershipRole,
  type MembershipRow,
  activeScopeOrgIds,
  isMembershipActive,
  resolveOrgMembership,
} from "@/lib/membership";

export const CLIENT_COOKIE = "nativespin_client";

export type Workspace = {
  userId: string;
  isAgency: boolean;
  agencyOrgId: string | null;
  // The user's OWN team org (User.organization) — but only while they still
  // hold an active seat in it (an agency's own org is the exception, see
  // resolveWorkspace). Stable across client/org switching — use this, not
  // activeOrgId, for "my team" scoping like favorites sharing. Null for
  // membership-only users and for anyone whose seat in it was revoked or
  // lapsed.
  homeOrgId: string | null;
  // The seat role in homeOrgId (null when there is no active seat). An agency
  // edits its OWN company details with this, not with the client's role.
  homeRole: MembershipRole | null;
  // The org buyer actions operate on. Advertiser = the selected org (own org
  // by default); agency = the selected client (null until one is picked).
  activeOrgId: string | null;
  // Org ids this user may read: every org with an active seat plus, for an
  // agency, all of its client orgs. Used for request/quote/report scoping.
  scopeOrgIds: string[];
  // Orgs where this user may commit (accept a quote, place an order): an
  // active seat with canCommit, or — for an agency — every org in scope.
  commitOrgIds: string[];
  // Resolved authority for activeOrgId from the membership row (null when there
  // is no active membership for the active org, e.g. pure agency path).
  activeRole: MembershipRole | null;
  activeCanCommit: boolean;
};

// Exported (only) so it's independently testable without a Next.js request
// scope — getWorkspace itself calls cookies(), which node:test can't
// provide, so the multi-membership ordering it depends on has to be
// verified at this layer instead.
export async function loadMemberships(userId: string): Promise<MembershipRow[]> {
  const rows = await prisma.membership.findMany({
    where: { userId },
    // Deterministic order so activeOrgId (below) doesn't depend on
    // whatever order Postgres happens to return rows in. Newest-granted
    // wins by default — the org a staff member was JUST given access to
    // is the one they're almost always here to work on.
    orderBy: { createdAt: "desc" },
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

export type WorkspaceInputs = {
  userId: string;
  // User.organization — the pointer to the user's own team, NOT a grant.
  homeOrg: { id: string; type: "ADVERTISER" | "AGENCY" } | null;
  memberships: MembershipRow[];
  // Client org ids of an AGENCY home org (ignored otherwise).
  agencyClientIds: string[];
  // Raw CLIENT_COOKIE value: a selection, validated here, never trusted.
  selectedOrgId: string | null;
  now: Date;
};

// The access model, as a pure function so it can be tested exhaustively.
//
// Access to an advertiser org comes ONLY from an active Membership. The home
// org pointer (User.organizationId) used to be granted implicitly on top of
// the seats, which meant revoking a member — or their delegation running out
// — changed nothing for anyone whose account had been created by an invite
// claim (the claim points the new account's home org at the inviting org).
// Now the pointer only picks the DEFAULT active org among orgs the user
// already holds a seat in. Signup gives the org creator an ADMIN seat, so
// creators are unaffected.
//
// An AGENCY home org is different: only the desk binds a user to an agency
// (there is no self-serve invite into one), and the agency's reach over its
// client orgs comes from Organization.parentOrgId, not from seats. That path
// is kept exactly as it was.
export function resolveWorkspace(input: WorkspaceInputs): Workspace | null {
  const { userId, homeOrg, memberships, now } = input;
  const seatOrgIds = activeScopeOrgIds(memberships, now);

  if (homeOrg?.type === "AGENCY") {
    const clientIds = input.agencyClientIds;
    const activeOrgId =
      input.selectedOrgId && clientIds.includes(input.selectedOrgId) ? input.selectedOrgId : null;
    const active = activeOrgId ? resolveOrgMembership(memberships, activeOrgId, now) : null;
    const scopeOrgIds = Array.from(new Set([homeOrg.id, ...clientIds, ...seatOrgIds]));
    return {
      userId,
      isAgency: true,
      agencyOrgId: homeOrg.id,
      homeOrgId: homeOrg.id,
      homeRole: resolveOrgMembership(memberships, homeOrg.id, now)?.role ?? null,
      activeOrgId,
      scopeOrgIds,
      // Agencies retain full control (including commit) over every org in
      // their scope — the pre-existing agency access path.
      commitOrgIds: scopeOrgIds,
      activeRole: active?.role ?? null,
      activeCanCommit: active?.canCommit ?? false,
    };
  }

  // No active seat anywhere: no workspace. Revoked and lapsed members land
  // here, as do staff accounts that were never given one.
  if (seatOrgIds.length === 0) return null;

  const homeOrgId = homeOrg && seatOrgIds.includes(homeOrg.id) ? homeOrg.id : null;
  const activeOrgId =
    input.selectedOrgId && seatOrgIds.includes(input.selectedOrgId)
      ? input.selectedOrgId
      : (homeOrgId ?? seatOrgIds[0]);
  const active = resolveOrgMembership(memberships, activeOrgId, now);
  const commitOrgIds = Array.from(
    new Set(
      memberships
        .filter((m) => m.canCommit && isMembershipActive(m, now))
        .map((m) => m.organizationId),
    ),
  );
  return {
    userId,
    isAgency: false,
    agencyOrgId: null,
    homeOrgId,
    homeRole: homeOrgId ? (resolveOrgMembership(memberships, homeOrgId, now)?.role ?? null) : null,
    activeOrgId,
    scopeOrgIds: seatOrgIds,
    commitOrgIds,
    activeRole: active?.role ?? null,
    activeCanCommit: active?.canCommit ?? false,
  };
}

// Orgs an overview page (home, requests, orders, reports) lists. A member of
// several orgs sees the ORG THEY SWITCHED TO, not a blend of all of them —
// the org switcher decides what they're looking at, while detail pages and
// deep links still open anything in scopeOrgIds. An agency's overviews keep
// spanning every client: that cross-client view is what the agency is for.
export function viewOrgIds(ws: Workspace): string[] {
  if (ws.isAgency) return ws.scopeOrgIds;
  return ws.activeOrgId ? [ws.activeOrgId] : [];
}

// The organisation whose company details (name, billing market) /account
// shows, and whether this workspace may edit them. An advertiser edits the
// org it is working in; an agency edits its own company, never a client's.
export function companySeat(ws: Workspace): { orgId: string | null; isAdmin: boolean } {
  if (ws.isAgency) return { orgId: ws.agencyOrgId, isAdmin: ws.homeRole === "ADMIN" };
  return { orgId: ws.activeOrgId, isAdmin: ws.activeRole === "ADMIN" };
}

// Resolve the workspace from the database for an explicit org selection.
// getWorkspace is the request-scoped wrapper; this is what tests drive.
export async function loadWorkspace(
  userId: string,
  selectedOrgId: string | null,
  now: Date = new Date(),
): Promise<Workspace | null> {
  const [user, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        deactivatedAt: true,
        organization: { select: { id: true, type: true } },
      },
    }),
    loadMemberships(userId),
  ]);

  // Sessions are JWTs, so an account deactivated mid-session keeps a valid
  // cookie until it expires. Denying the workspace here is what makes the
  // deactivation bite on everything org-scoped — API routes and server
  // actions included — not just the page render the layout guards. Costs
  // nothing: the row was already being read.
  if (!user || user.deactivatedAt) return null;

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

  const homeOrg = user.organization;
  const agencyClientIds =
    homeOrg?.type === "AGENCY"
      ? (
          await prisma.organization.findMany({
            where: { parentOrgId: homeOrg.id },
            select: { id: true },
          })
        ).map((c) => c.id)
      : [];

  return resolveWorkspace({
    userId,
    homeOrg,
    memberships,
    agencyClientIds,
    selectedOrgId,
    now,
  });
}

// Resolve the acting workspace for a signed-in user. Returns null when the
// user holds no active seat and is not an agency (e.g. desk/publisher
// accounts, or a member whose access was revoked or has lapsed).
export async function getWorkspace(
  userId: string | undefined,
): Promise<Workspace | null> {
  if (!userId) return null;
  const store = await cookies();
  return loadWorkspace(userId, store.get(CLIENT_COOKIE)?.value ?? null);
}
