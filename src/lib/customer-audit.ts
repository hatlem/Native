// The customer's own view of the audit trail (/audit).
//
// AuditLog is written for the platform: its rows carry internal fields (cost
// and margin edits, accounting-provider answers, IP addresses, desk notes).
// A customer admin sees only what is listed here — an explicit allowlist of
// actions, and for each action an explicit allowlist of detail fields.
// Anything not listed is not shown, so a new internal action or a new field
// on an existing one stays private until someone adds it on purpose.
import type { Prisma } from "@prisma/client";

export type CustomerAuditCategory =
  | "request"
  | "quote"
  | "order"
  | "invoice"
  | "team"
  | "access"
  | "export"
  | "list"
  | "article";

type ActionSpec = {
  category: CustomerAuditCategory;
  // Detail keys that may be shown. Only primitive values are ever shown.
  fields?: readonly string[];
};

export const CUSTOMER_AUDIT_ACTIONS: Readonly<Record<string, ActionSpec>> = {
  "request.submit": { category: "request" },
  "request.withdrawn_by_buyer": { category: "request", fields: ["reason"] },
  "api.order.create": { category: "request" },

  "quote.send": { category: "quote", fields: ["total", "currency"] },
  "quote.accept": { category: "quote" },
  "quote.declined_by_buyer": { category: "quote", fields: ["reason"] },
  "quote.revise": { category: "quote" },
  "quote.renew": { category: "quote" },
  "quote.renewal_requested": { category: "quote" },
  "quote.pdf.download": { category: "quote" },
  "quote.pdf.generate": { category: "quote" },
  "quote.docx.export": { category: "quote" },

  "order.advance": { category: "order", fields: ["from", "to"] },
  "order.cancel": { category: "order", fields: ["from"] },
  "order.cancellation_requested": { category: "order", fields: ["reason"] },
  "order.extra_work.add": { category: "order" },
  "order.extra_work.remove": { category: "order" },
  "order.feedback_submitted": { category: "order" },
  "order.flight_window.save": { category: "order", fields: ["start", "end"] },

  "invoice.issue": { category: "invoice", fields: ["number", "total", "currency"] },
  "credit_note.issue": { category: "invoice", fields: ["number", "amount", "currency"] },
  "invoice.pdf.download": { category: "invoice" },

  "org.invite_sent": { category: "team", fields: ["email", "role"] },
  "org.invite_revoked": { category: "team" },
  "org.membership_updated": { category: "team", fields: ["role"] },
  "org.membership_revoked": { category: "team" },
  "organization.updated": { category: "team", fields: ["name"] },
  "org.payment_terms_set": { category: "team" },

  "api_key.create": { category: "access", fields: ["name"] },
  "api_key.revoke": { category: "access", fields: ["name"] },
  // NativeSpin staff opened the customer's workspace ("view as customer").
  "superadmin.view_as_start": { category: "access" },
  "superadmin.view_as_end": { category: "access" },

  "data.export": { category: "export" },

  "list.create": { category: "list" },
  "list.archive": { category: "list" },
  "list.restore": { category: "list" },
  "list.duplicate": { category: "list" },
  "list.share_enable": { category: "list" },
  "list.share_disable": { category: "list" },
  "list.client_approved": { category: "list" },
  "plan.duplicate": { category: "list" },

  "article.create": { category: "article" },
  "article.link": { category: "article" },
  "article.unlink": { category: "article" },
};

export const CUSTOMER_AUDIT_CATEGORIES: readonly CustomerAuditCategory[] = [
  "request",
  "quote",
  "order",
  "invoice",
  "team",
  "access",
  "export",
  "list",
  "article",
];

export function isCustomerAuditCategory(v: string): v is CustomerAuditCategory {
  return (CUSTOMER_AUDIT_CATEGORIES as readonly string[]).includes(v);
}

export function customerAuditActions(category?: CustomerAuditCategory | null): string[] {
  return Object.entries(CUSTOMER_AUDIT_ACTIONS)
    .filter(([, spec]) => !category || spec.category === category)
    .map(([action]) => action);
}

// Message key for an action's label: "quote.pdf.download" → "quote_pdf_download".
export function customerAuditActionKey(action: string): string {
  return action.replace(/\./g, "_");
}

export type CustomerAuditFilters = {
  category?: CustomerAuditCategory | null;
  from?: Date | null; // inclusive
  to?: Date | null; // exclusive
};

// The ONLY query shape the page and the export use: one organisation, and
// only allowlisted actions. `organizationId` is never taken from the request.
export function customerAuditWhere(
  organizationId: string,
  filters: CustomerAuditFilters = {},
): Prisma.AuditLogWhereInput {
  return {
    organizationId,
    action: { in: customerAuditActions(filters.category) },
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lt: filters.to } : {}),
          },
        }
      : {}),
  };
}

// "2026-11-01" → that day 00:00 UTC; anything else → null.
export function parseAuditDate(raw: string | string[] | undefined): Date | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// The day after `d` — an inclusive "to" date becomes an exclusive bound.
export function dayAfter(d: Date): Date {
  return new Date(d.getTime() + 86_400_000);
}

const MAX_VALUE_CHARS = 200;

// The allowlisted detail fields of one row, as [key, text] pairs. Unknown
// actions and non-JSON details yield nothing.
export function customerAuditDetail(action: string, detail: string | null): [string, string][] {
  const spec = CUSTOMER_AUDIT_ACTIONS[action];
  if (!spec?.fields || !detail) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const out: [string, string][] = [];
  for (const key of spec.fields) {
    const v = (parsed as Record<string, unknown>)[key];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      const text = String(v).trim();
      if (text) out.push([key, text.slice(0, MAX_VALUE_CHARS)]);
    }
  }
  return out;
}

export type AuditActorInfo = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  // Does (or did) this user belong to the organisation whose trail this is?
  belongsToOrg: boolean;
};

export type CustomerAuditActor =
  | { kind: "member"; label: string }
  | { kind: "staff" }
  | { kind: "system" }
  | { kind: "other" };

// Who the customer is told did it. Their own people by name; NativeSpin staff
// only as "NativeSpin desk" (never an employee's name or email); the platform
// itself as automatic; anyone else (a deleted user, a publisher) unnamed.
export function customerAuditActor(actorId: string, user: AuditActorInfo | undefined): CustomerAuditActor {
  if (actorId === "system" || actorId === "anonymous") return { kind: "system" };
  if (!user) return { kind: "other" };
  if (user.role === "DESK" || user.role === "SUPERADMIN") return { kind: "staff" };
  if (user.belongsToOrg) return { kind: "member", label: user.name?.trim() || user.email || "—" };
  return { kind: "other" };
}

// May this workspace read the trail of its active organisation? Admins only:
// the trail names colleagues and their actions.
export function canReadCustomerAudit(ws: { activeOrgId: string | null; activeRole: string | null } | null): string | null {
  if (!ws?.activeOrgId || ws.activeRole !== "ADMIN") return null;
  return ws.activeOrgId;
}
