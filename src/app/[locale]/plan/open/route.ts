// Deep-link entry point for /plan. A notification (today: the placement-ready
// sweep) links here to make a specific SavedList the ACTIVE one, then land on
// /plan.
//
// Why a Route Handler and not a `?list=` query param on the page: /plan is not
// read-only. Its "Send til desk" form action (submitRequest, checkout-actions)
// resolves which list to submit from the active-list cookie — never from the
// URL the page was rendered with. A render-time query override would therefore
// show list B while the button submitted list A, which on the firm-order path
// means charging for lines the buyer never saw. Server Components can't write
// cookies; Route Handlers can. Setting the cookie here keeps the rendered plan
// and the submitted plan the same list, by construction.
//
// This is the only place that may write the active-list cookie from a GET —
// everywhere else, list switching is a form action. No separate ownership
// check is needed here: resolveActiveList() (the page's own read path) already
// rejects any list id that isn't the signed-in org's, falling back to the
// org's most recent list, so writing an unowned id to the cookie is harmless —
// the next render simply ignores it.

import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspace } from "@/lib/workspace";
import { writeActiveListId } from "@/lib/lists";
import { appUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  const listId = request.nextUrl.searchParams.get("list");
  if (ws?.activeOrgId && listId) {
    await writeActiveListId(listId);
  }
  // appUrl(), not request.url: behind Railway's proxy the inbound URL can carry
  // an internal host, and every other redirect in this app builds from appUrl().
  return NextResponse.redirect(new URL(`/${locale}/plan`, appUrl()));
}
