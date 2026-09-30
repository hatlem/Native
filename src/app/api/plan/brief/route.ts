// The last-edit flush for /plan's brief autosave (PlanBriefFields). While the
// buyer types, the brief saves through the savePlanBrief server action. When
// they leave before the debounce fires (a header link, closing the tab,
// switching apps), that pending edit goes here with `fetch(..., { keepalive:
// true })`, which the browser completes after the page is gone; a server
// action call can't be marked keepalive, so it dies with the page.
//
// Same authorization as the server action: a signed-in user whose workspace
// scope holds the plan (resolvePlanTarget), never an archived plan. JSON only:
// a cross-site form can't send application/json without a CORS preflight,
// which this route never grants, and the session cookie is SameSite=Lax.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadScope } from "@/lib/scope";
import { resolvePlanTarget } from "@/lib/plan-target";
import { saveListBrief } from "@/lib/plan-brief";

export const dynamic = "force-dynamic";

// Field shapes only; normalizeListBrief (lib/plan-brief.ts) trims, caps and
// validates the values exactly as it does for the server action.
const Body = z.object({
  listId: z.string().min(1).max(64),
  brief: z.object({
    briefText: z.string().max(20_000).nullish(),
    briefTiming: z.string().max(64).nullish(),
    budget: z.string().max(32).nullish(),
    budgetCurrency: z.string().max(8).nullish(),
    targetAudience: z.array(z.string().max(64)).max(32).nullish(),
    targetGeo: z.string().max(2_000).nullish(),
    targetContext: z.string().max(2_000).nullish(),
  }),
});

export async function POST(req: NextRequest) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  const scope = await loadScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const target = await resolvePlanTarget(scope.workspace, parsed.data.listId);
  // One answer for unknown, foreign and archived: nothing to probe.
  if (!target.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await saveListBrief(target.list.id, parsed.data.brief);
  return new NextResponse(null, { status: 204 });
}
