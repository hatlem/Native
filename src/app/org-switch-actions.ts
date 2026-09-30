"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/workspace";
import { switchActiveOrg } from "@/lib/active-org";
import { safeLocale } from "@/i18n/routing";

// A member of several orgs picks which one they're working in — the
// non-agency twin of agency-actions selectClient, on the same CLIENT_COOKIE.
// Only an org the user holds an active seat in is accepted; anything else
// (tampered form, a seat revoked since the menu rendered) changes nothing.
// Lands on the plain home page: it is scoped to the active org, and a
// searchParams redirect onto the current route 503s in prod.
export async function switchOrg(formData: FormData) {
  const locale = safeLocale(String(formData.get("locale") || ""));
  const organizationId = String(formData.get("organizationId") || "");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const ws = await getWorkspace(session.user.id);
  // Agencies switch clients from /agency (their scope is parentOrgId-based,
  // not seat-based); this action is for seat holders only.
  if (ws && !ws.isAgency && ws.scopeOrgIds.includes(organizationId)) {
    await switchActiveOrg(organizationId);
  }
  redirect(`/${locale}/home`);
}
