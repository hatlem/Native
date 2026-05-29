// Shared role / scope helpers. The goal is one obvious answer to
// "may this session touch this entity?" so pages and server actions
// stop hand-rolling guards.

import type { Session } from "next-auth";
import { auth } from "@/auth";
import { getWorkspace, type Workspace } from "@/lib/workspace";

export type Scope = {
  session: Session | null;
  role: string | undefined;
  userId: string | undefined;
  isDesk: boolean;
  isPublisher: boolean;
  workspace: Workspace | null;
};

export async function loadScope(): Promise<Scope> {
  // The `auth()` helper is overloaded for middleware/route-handler/
  // server-component use. The server-component overload returns
  // `Session | null`; assert it so TS picks the right one.
  const session = (await auth()) as Session | null;
  const role = session?.user?.role;
  const userId = session?.user?.id;
  const workspace = await getWorkspace(userId);
  return {
    session,
    role,
    userId,
    isDesk: role === "DESK" || role === "SUPERADMIN",
    isPublisher: role === "PUBLISHER" || role === "SUPERADMIN",
    workspace,
  };
}

// "May this scope read/write things belonging to orgId?" — true for the
// desk, for the owning org itself, and for an agency that has the org
// as a managed client.
export function canActOnOrg(scope: Scope, organizationId: string): boolean {
  if (scope.isDesk) return true;
  return !!scope.workspace?.scopeOrgIds.includes(organizationId);
}

/**
 * May this user *commit* the org — accept a quote / place an order — on `organizationId`?
 * Commit authority is per-ACTIVE-org and never inferred from the (possibly stale) JWT role.
 */
export function canCommitOnOrg(scope: Scope, organizationId: string): boolean {
  if (scope.isDesk) return true;
  const ws = scope.workspace;
  if (!ws) return false;
  // Agencies retain full control (including commit) over orgs in their scope —
  // the pre-existing agency access path, unchanged by membership gating.
  if (ws.isAgency) return ws.scopeOrgIds.includes(organizationId);
  // Advertiser-org members: commit only on the active org, and only with the grant.
  return ws.activeOrgId === organizationId && ws.activeCanCommit === true;
}
