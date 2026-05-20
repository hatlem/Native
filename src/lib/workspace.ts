import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const CLIENT_COOKIE = "benative_client";

export type Workspace = {
  userId: string;
  isAgency: boolean;
  agencyOrgId: string | null;
  // The org buyer actions operate on. Advertiser = own org; agency =
  // the selected client (null until one is picked).
  activeOrgId: string | null;
  // Org ids this user may read: own/active org plus, for an agency, all
  // of its client orgs. Used for request/quote/report scoping.
  scopeOrgIds: string[];
};

// Resolve the acting workspace for a signed-in user. Returns null when the
// user has no organization (e.g. desk/publisher accounts).
export async function getWorkspace(
  userId: string | undefined,
): Promise<Workspace | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organization: { select: { id: true, type: true } } },
  });
  const org = user?.organization;
  if (!org) return null;

  if (org.type !== "AGENCY") {
    return {
      userId,
      isAgency: false,
      agencyOrgId: null,
      activeOrgId: org.id,
      scopeOrgIds: [org.id],
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

  return {
    userId,
    isAgency: true,
    agencyOrgId: org.id,
    activeOrgId,
    scopeOrgIds: [org.id, ...clientIds],
  };
}
