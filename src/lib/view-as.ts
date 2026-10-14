// "Se som kunde": a SUPERADMIN opens the buyer side of one customer org and
// sees it exactly as that org's ADMIN does (lib/workspace builds the
// workspace; app/view-as-actions starts and ends it).
//
// Everything a customer can do works in this mode, but a commit — accepting a
// quote, placing an instant order — is real and binds the customer. So the
// commit forms carry a confirmation checkbox while viewing as the org, and the
// commit actions refuse without it (viewAsCommitConfirmed).

import type { Workspace } from "@/lib/workspace";

export const VIEW_AS_CONFIRM_FIELD = "viewAsConfirm";

// Short on purpose: a forgotten session should not leave a superadmin
// browsing as a customer the next morning.
export const VIEW_AS_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 8,
};

/** Is this workspace a superadmin viewing as `organizationId`? */
export function isViewingAs(ws: Workspace | null | undefined, organizationId: string): boolean {
  return !!ws?.viewingAsOrgId && ws.viewingAsOrgId === organizationId;
}

/**
 * May a commit on `organizationId` go ahead? Always, unless a superadmin is
 * viewing as that org: then only when the form carried the confirmation.
 */
export function viewAsCommitConfirmed(
  ws: Workspace | null | undefined,
  organizationId: string,
  formData: FormData,
): boolean {
  if (!isViewingAs(ws, organizationId)) return true;
  return formData.get(VIEW_AS_CONFIRM_FIELD) === "1";
}
