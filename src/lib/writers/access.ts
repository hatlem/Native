import type { ContentAssetStatus } from "@prisma/client";

// Pure write-permission decision for a single order line. DESK/SUPERADMIN
// always; CONTENT only when the line is assigned to their own user id.
export function canWriteLine(args: {
  role: string | undefined;
  userId: string | undefined;
  assignedWriterUserId: string | null | undefined;
}): boolean {
  const { role, userId, assignedWriterUserId } = args;
  if (!userId) return false;
  if (role === "DESK" || role === "SUPERADMIN") return true;
  if (role === "CONTENT") return assignedWriterUserId === userId;
  return false;
}

// A line may only be assigned to a writer already in the order's pool.
export function canAssignWriter(
  poolWriterIds: string[],
  writerId: string,
): boolean {
  return poolWriterIds.includes(writerId);
}

// Capacity counting: an assignment is "active" until its latest content
// asset reaches FINAL. No asset yet (null) still counts — the writer owes
// an article. Retraction no longer flows through ContentAssetStatus (it's
// a per-placement field now) and doesn't change whether the underlying
// writing is done, so it plays no part in this check.
export function isAssignmentActive(
  latestAssetStatus: ContentAssetStatus | null,
): boolean {
  return latestAssetStatus !== "FINAL";
}

const ORG_SCOPED_ROLES = new Set(["BUYER", "APPROVER", "ORG_ADMIN"]);

export function canWriteArticle(args: {
  role: string | undefined;
  userId: string | undefined;
  organizationId: string;
  scopeOrgIds: string[];
  assignedWriterUserId: string | null | undefined;
}): boolean {
  const { role, userId, organizationId, scopeOrgIds, assignedWriterUserId } = args;
  if (!userId) return false;
  if (role === "DESK" || role === "SUPERADMIN") return true;
  if (role === "CONTENT") return assignedWriterUserId === userId;
  if (role && ORG_SCOPED_ROLES.has(role)) return scopeOrgIds.includes(organizationId);
  return false;
}
