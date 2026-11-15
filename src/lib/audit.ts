import { log } from "@/lib/log";
// Audit log writer — PLAN §14: every state-changing action records who
// did what to which entity. Best-effort: a failure to write the audit
// row must not fail the user action that triggered it (the action's own
// row is the durable record), so we swallow + console.error here.

import { prisma } from "@/lib/prisma";

export type AuditActor = string | { userId?: string | null } | null | undefined;

function actorId(actor: AuditActor): string {
  if (!actor) return "system";
  if (typeof actor === "string") return actor;
  return actor.userId ?? "system";
}

// The tenant an audit row concerns, when the caller's detail names it
// (`organizationId`, or `viewAsOrgId` for writes made in view-as mode).
// Stored in its own indexed column so the trail can be filtered per org.
export function auditOrganizationId(
  detail: string | Record<string, unknown> | null | undefined,
): string | null {
  if (!detail || typeof detail === "string") return null;
  for (const key of ["organizationId", "orgId", "viewAsOrgId"]) {
    const v = detail[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

// A superadmin in "view as customer" mode acts with the customer's rights, so
// every row they write in that mode is tagged with the org being viewed
// (`viewAsOrgId`). Done here, once, so no action can forget it. The cookie
// alone is not trusted — anyone can set a cookie — so the tag is only added
// when the actor really is an active SUPERADMIN. Best-effort: outside a
// request scope (scripts, sweeps, tests) there is no cookie and no tag.
const VIEW_AS_COOKIE_NAME = "nativespin_view_as"; // = VIEW_AS_COOKIE in lib/workspace

async function viewAsOrgIdFor(actor: string): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const orgId = (await cookies()).get(VIEW_AS_COOKIE_NAME)?.value;
    if (!orgId || actor === "system" || actor === "anonymous") return null;
    const user = await prisma.user.findUnique({
      where: { id: actor },
      select: { role: true, deactivatedAt: true },
    });
    return user?.role === "SUPERADMIN" && !user.deactivatedAt ? orgId : null;
  } catch {
    return null;
  }
}

// Merge the view-as tag into an audit detail. A string detail is kept under
// `note` so the tag has somewhere to live.
export function withViewAsTag(
  detail: string | Record<string, unknown> | null | undefined,
  viewAsOrgId: string | null,
): string | Record<string, unknown> | null | undefined {
  if (!viewAsOrgId) return detail;
  if (detail == null) return { viewAsOrgId };
  if (typeof detail === "string") return { note: detail, viewAsOrgId };
  return "viewAsOrgId" in detail ? detail : { ...detail, viewAsOrgId };
}

export async function recordAudit(
  actor: AuditActor,
  action: string,
  entity: string,
  rawDetail?: string | Record<string, unknown> | null,
): Promise<void> {
  try {
    const detail = withViewAsTag(rawDetail, await viewAsOrgIdFor(actorId(actor)));
    await prisma.auditLog.create({
      data: {
        actor: actorId(actor),
        action,
        entity,
        organizationId: auditOrganizationId(detail),
        detail:
          detail == null
            ? null
            : typeof detail === "string"
              ? detail
              : JSON.stringify(detail),
      },
    });
  } catch (err) {
    log.error("audit.write_failed", { action, entity, err });
  }
}

// The row recordAudit would write, for callers that must write it INSIDE
// their own transaction (billing: an issued invoice and its audit row commit
// together or not at all). Resolve it BEFORE opening the transaction — the
// view-as lookup reads outside it — then `tx.auditLog.create({ data })`.
// Unlike recordAudit this is not best-effort: a failed write fails the
// transaction, which is the point.
export async function auditRowData(
  actor: AuditActor,
  action: string,
  entity: string,
  rawDetail?: string | Record<string, unknown> | null,
): Promise<{ actor: string; action: string; entity: string; organizationId: string | null; detail: string | null }> {
  const detail = withViewAsTag(rawDetail, await viewAsOrgIdFor(actorId(actor)));
  return {
    actor: actorId(actor),
    action,
    entity,
    organizationId: auditOrganizationId(detail),
    detail: detail == null ? null : typeof detail === "string" ? detail : JSON.stringify(detail),
  };
}

// Convenience: bind the same actor to a sequence of audit writes (e.g.
// inside one server action). Saves repeating the session lookup.
export function auditFor(actor: AuditActor) {
  return (action: string, entity: string, detail?: Parameters<typeof recordAudit>[3]) =>
    recordAudit(actor, action, entity, detail);
}
