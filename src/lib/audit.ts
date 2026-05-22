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

export async function recordAudit(
  actor: AuditActor,
  action: string,
  entity: string,
  detail?: string | Record<string, unknown> | null,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actor: actorId(actor),
        action,
        entity,
        detail:
          detail == null
            ? null
            : typeof detail === "string"
              ? detail
              : JSON.stringify(detail),
      },
    });
  } catch (err) {
    console.error("audit.write_failed", { action, entity, err });
  }
}

// Convenience: bind the same actor to a sequence of audit writes (e.g.
// inside one server action). Saves repeating the session lookup.
export function auditFor(actor: AuditActor) {
  return (action: string, entity: string, detail?: Parameters<typeof recordAudit>[3]) =>
    recordAudit(actor, action, entity, detail);
}
