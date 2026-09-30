// Makes a specific SavedList the ACTIVE one, then lands on its canonical
// address /plan/<listId>. Used by /plan/[listId] whenever the active-list
// cookie names another list (a bookmark, a shared link, "Open" on Saved
// lists) and by deep links such as the placement-ready notification.
//
// Why a Route Handler: /plan is not read-only. "Send til desk"
// (submitRequest, checkout-actions) and every add-from-catalog resolve their
// list from the active-list cookie — never from the URL. Server Components
// can't write cookies; Route Handlers can. Switching here keeps the rendered
// plan and the submitted plan the same list, by construction.
//
// Access is checked here, not deferred to the render: /plan/[listId] sends any
// cookie mismatch back to this handler, so writing an id the page would then
// reject would bounce forever. A list the viewer can't open (unknown, archived,
// outside their scope) lands on /plan, which picks their own active plan.
// A list in another org the viewer belongs to (agency client, second
// membership) also switches the active org, as the org switcher would.

import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { writeActiveListId } from "@/lib/lists";
import { switchActiveOrg } from "@/lib/active-org";
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

  const list = listId
    ? await prisma.savedList.findUnique({
        where: { id: listId },
        select: { id: true, organizationId: true, archivedAt: true },
      })
    : null;
  const canOpen = !!ws && !!list && !list.archivedAt && ws.scopeOrgIds.includes(list.organizationId);

  // appUrl(), not request.url: behind Railway's proxy the inbound URL can carry
  // an internal host, and every other redirect in this app builds from appUrl().
  // Say WHY the viewer lands on another plan: a stale bookmark silently showing
  // a different plan read as "my plan changed". Archived gets its own wording;
  // unknown and out-of-scope share one, so the notice can't probe other orgs.
  if (!canOpen) {
    const ownArchived = !!list?.archivedAt && !!ws?.scopeOrgIds.includes(list.organizationId);
    const notice = listId ? { notice: ownArchived ? "plan-archived" : "plan-unavailable" } : {};
    return NextResponse.redirect(new URL(planPath(locale, null, { ...rest, ...notice }), appUrl()));
  }

  if (list.organizationId !== ws.activeOrgId) {
    await switchActiveOrg(list.organizationId, { activeListId: list.id });
  } else {
    await writeActiveListId(list.id);
  }
  return NextResponse.redirect(new URL(planPath(locale, list.id, rest), appUrl()));
}
