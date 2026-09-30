import { cookies } from "next/headers";
import { CLIENT_COOKIE } from "@/lib/workspace";
import { clearActiveListId, writeActiveListId } from "@/lib/lists";

const CLIENT_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

// The ONE way to change which org buyer actions operate on (agency client
// switch, a member's org switcher, landing after an invite claim, a plan deep
// link into another org). The caller must already have checked that the org
// is in the viewer's scope — getWorkspace re-validates the cookie on every
// request anyway, so a stale or forged value only ever falls back.
//
// The active-list cookie always moves with it. It names a plan of the org
// being left; kept as-is, /plan/<id> for that same plan would trust the
// cookie ("already active"), resolve it inside the NEW org, fail, and land on
// the new org's plan with no switch back. Either the caller names the plan
// that is now active (plan/open), or the org's own most recent plan is
// adopted on the next /plan render.
export async function switchActiveOrg(
  organizationId: string | null,
  opts: { activeListId?: string } = {},
): Promise<void> {
  const store = await cookies();
  if (organizationId) store.set(CLIENT_COOKIE, organizationId, CLIENT_COOKIE_OPTS);
  else store.delete(CLIENT_COOKIE);

  if (opts.activeListId) await writeActiveListId(opts.activeListId);
  else await clearActiveListId();
}
