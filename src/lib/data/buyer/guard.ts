// Guards shared by the buyer data loaders (src/lib/data/buyer). A loader
// takes the caller's scope first and enforces the organisation boundary
// itself, so a page cannot forget the filter.

import type { Scope } from "@/lib/scope";
import type { Workspace } from "@/lib/workspace";

// What a buyer loader needs to know about the caller. A Scope from
// lib/scope loadScope() is one; pages that only resolve a workspace build
// one with buyerScope() — no extra query either way.
export type BuyerScope = Pick<Scope, "userId" | "isDesk" | "workspace">;

export function buyerScope(
  user: { id?: string | null; role?: string | null } | null | undefined,
  workspace: Workspace | null,
): BuyerScope {
  const role = user?.role;
  return {
    userId: user?.id ?? undefined,
    isDesk: role === "DESK" || role === "SUPERADMIN",
    workspace,
  };
}

// Same rule as lib/scope canActOnOrg: the desk, any active seat in the org,
// or an agency that manages it.
export function canRead(scope: BuyerScope, organizationId: string): boolean {
  if (scope.isDesk) return true;
  return !!scope.workspace?.scopeOrgIds.includes(organizationId);
}

// Every list or child loader calls this first: no signed-in user, no data.
export function assertScope(scope: BuyerScope): void {
  if (!scope || !scope.userId) {
    throw new Error("Buyer data loader called without a signed-in scope");
  }
}

// The row if this scope may read its organisation, otherwise null — the
// same answer a missing row gives, so "not yours" and "not found" look alike.
export function readableOrNull<T extends { organizationId: string }>(
  scope: BuyerScope,
  row: T | null,
): T | null {
  if (!row) return null;
  return canRead(scope, row.organizationId) ? row : null;
}

// For list queries filtered by organisation: the ids must all be ones this
// scope may read. A page passes ids it took from the workspace; anything
// else is a bug, and it fails loudly instead of leaking another org's rows.
export function assertReadableOrgIds(scope: BuyerScope, organizationIds: readonly string[]): void {
  assertScope(scope);
  for (const id of organizationIds) {
    if (!canRead(scope, id)) {
      throw new Error("Buyer data loader asked for an organisation outside the caller's scope");
    }
  }
}

// The caller's workspace, for loaders that list across the caller's own
// organisations. Deriving the ids from the scope inside the loader is what
// makes the filter impossible to forget.
export function requireWorkspace(scope: BuyerScope): Workspace {
  assertScope(scope);
  if (!scope.workspace) {
    throw new Error("Buyer data loader called without a workspace");
  }
  return scope.workspace;
}

// What a list loader returns when the caller may not read the organisation
// it asked for: no rows. Typed as never so the loader keeps its row type.
export function noRows(): never {
  return [] as never;
}
