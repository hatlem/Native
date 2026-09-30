// Makes a specific SavedList the ACTIVE one, then lands on its canonical
// address /plan/<listId>. Used by /plan/[listId] whenever the active-list
// cookie names another list (a bookmark, a shared link, "Open" on Saved
// lists) and by deep links such as the placement-ready notification.
//
// Why a Route Handler: Server Components can't write cookies; Route Handlers
// can. The plan page's own forms post their listId (lib/plan-target.ts), but
// the catalog's "Add to plan" and other off-page adds still target the active
// list, so opening a plan makes it the one those adds land on.
//
// Access is checked here, not deferred to the render: /plan/[listId] sends any
// cookie mismatch back to this handler, so writing an id the page would then
// reject would bounce forever. A list the viewer can't open (unknown, archived,
// outside their scope) lands on /plan, which picks their own active plan.
// A list in another org the viewer belongs to (agency client, second
// membership) also switches the active org, as the org switcher would.

import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/workspace";
import { alignActivePlan, refusalNotice, resolvePlanTarget } from "@/lib/plan-target";
import { planPath } from "@/lib/plan-path";
import { appUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  const search = Object.fromEntries(request.nextUrl.searchParams);
  const { list: listId, ...rest } = search;
  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  const target = await resolvePlanTarget(ws, listId);

  // appUrl(), not request.url: behind Railway's proxy the inbound URL can carry
  // an internal host, and every other redirect in this app builds from appUrl().
  // Say WHY the viewer lands on another plan: a stale bookmark silently showing
  // a different plan read as "my plan changed" (refusalNotice).
  if (!ws || !target.ok) {
    const notice = listId ? refusalNotice(target) : undefined;
    return NextResponse.redirect(new URL(planPath(locale, null, { ...rest, ...notice }), appUrl()));
  }

  await alignActivePlan(ws, target.list);
  return NextResponse.redirect(new URL(planPath(locale, target.list.id, rest), appUrl()));
}
