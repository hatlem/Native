// CSV export of an organisation's own audit trail — the same rows, the same
// allowlist and the same scope as the /audit page (lib/customer-audit*.ts).
// Admins of the active organisation only; the organisation comes from the
// session, never from the request.
import { NextRequest, NextResponse } from "next/server";
import { loadScope } from "@/lib/scope";
import { csv } from "@/lib/csv";
import { recordAudit } from "@/lib/audit";
import { exportLimiter } from "@/lib/rate-limit";
import {
  canReadCustomerAudit,
  dayAfter,
  isCustomerAuditCategory,
  parseAuditDate,
} from "@/lib/customer-audit";
import { loadCustomerAudit } from "@/lib/customer-audit-load";

export const dynamic = "force-dynamic";

// One export is at most this many rows; narrow the dates for more.
const MAX_ROWS = 5000;

export async function GET(req: NextRequest) {
  const scope = await loadScope();
  if (!scope.userId || !scope.workspace) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const orgId = canReadCustomerAudit(scope.workspace);
  if (!orgId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Shares the per-user export budget with /api/export/me.
  const limit = await exportLimiter.check(`export:${scope.userId}`);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate limit", retryAfterMs: limit.retryAfterMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  const sp = req.nextUrl.searchParams;
  const categoryParam = sp.get("category") ?? "";
  const from = parseAuditDate(sp.get("from") ?? undefined);
  const toDay = parseAuditDate(sp.get("to") ?? undefined);
  const rows = await loadCustomerAudit(
    orgId,
    {
      category: isCustomerAuditCategory(categoryParam) ? categoryParam : null,
      from,
      to: toDay ? dayAfter(toDay) : null,
    },
    { skip: 0, take: MAX_ROWS },
  );

  await recordAudit(scope.userId, "data.export", `Organization:${orgId}`, { what: "audit_log", rows: rows.length });

  const out = rows.map((r) => ({
    when: r.createdAt.toISOString(),
    who:
      r.actor.kind === "member"
        ? r.actor.label
        : r.actor.kind === "staff"
          ? "NativeSpin desk"
          : r.actor.kind === "system"
            ? "NativeSpin (automatic)"
            : "outside organisation",
    area: r.category,
    action: r.action,
    details: r.detail.map(([k, v]) => `${k}=${v}`).join("; "),
  }));

  return new NextResponse(csv(out, ["when", "who", "area", "action", "details"]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
