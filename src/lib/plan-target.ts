// Which plan does a /plan action act on?
//
// Every plan has its own address, /plan/<listId>, and a buyer can have several
// open in different tabs. The active-list cookie only remembers the plan opened
// LAST, in any tab, so an action that trusted it would submit, edit or share
// whatever plan another tab opened most recently (a "Send" in the tab showing
// plan A once sent plan B to the desk). The page therefore posts the listId it
// renders, and the action resolves it here: the list must exist, must not be
// archived, and must belong to an org the viewer's workspace reaches. Only then
// does the action act on it, and afterwards it makes that plan the active one
// again (alignActivePlan), so the catalog's "Add to plan" follows the plan the
// buyer last worked on.

import { prisma } from "@/lib/prisma";
import type { Workspace } from "@/lib/workspace";
import { writeActiveListId } from "@/lib/lists";
import { switchActiveOrg } from "@/lib/active-org";

export type PlanTargetList = { id: string; organizationId: string };

export type PlanTarget =
  | { ok: true; list: PlanTargetList }
  // missing: no id posted or no such list; archived: the plan was archived
  // (possibly in another tab); forbidden: the list lives in an org outside
  // the viewer's workspace (a tampered post, or access revoked since).
  | { ok: false; reason: "missing" | "archived" | "forbidden" };

/** Resolve a posted listId to a plan the viewer may act on. */
export async function resolvePlanTarget(
  ws: Pick<Workspace, "scopeOrgIds"> | null,
  listId: string | null | undefined,
): Promise<PlanTarget> {
  if (!listId) return { ok: false, reason: "missing" };
  const list = await prisma.savedList.findUnique({
    where: { id: listId },
    select: { id: true, organizationId: true, archivedAt: true },
  });
  if (!list) return { ok: false, reason: "missing" };
  // Scope before archive state, so a foreign id never reveals whether it
  // exists or was archived.
  if (!ws || !ws.scopeOrgIds.includes(list.organizationId)) return { ok: false, reason: "forbidden" };
  if (list.archivedAt) return { ok: false, reason: "archived" };
  return { ok: true, list: { id: list.id, organizationId: list.organizationId } };
}

/**
 * The /plan notice explaining why the viewer landed on another plan than the
 * one they asked for (PlanBanners: ?notice=). Archived gets its own wording;
 * unknown and out-of-scope share one, so the notice can't probe other orgs
 * (resolvePlanTarget only reports "archived" for a plan in the viewer's scope).
 */
export function refusalNotice(target: PlanTarget): { notice: "plan-archived" | "plan-unavailable" } | undefined {
  if (target.ok) return undefined;
  return { notice: target.reason === "archived" ? "plan-archived" : "plan-unavailable" };
}

/**
 * Make `list` the active plan (the cookie the catalog's add actions read). A
 * plan in another org the viewer can act on (agency client, second membership)
 * switches the active org too, exactly as opening it through /plan/open would.
 * Only call with a list resolvePlanTarget accepted for this workspace.
 */
export async function alignActivePlan(
  ws: Pick<Workspace, "activeOrgId">,
  list: PlanTargetList,
): Promise<void> {
  if (list.organizationId !== ws.activeOrgId) {
    await switchActiveOrg(list.organizationId, { activeListId: list.id });
  } else {
    await writeActiveListId(list.id);
  }
}
