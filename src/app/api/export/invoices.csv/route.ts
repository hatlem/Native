// Desk-only invoice export — feeds whatever accounting tool the finance
// team picks (PLAN §13). Plain RFC 4180 CSV per market; the caller
// uploads it into Fortnox / Visma / etc.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { csv } from "@/lib/csv";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "DESK" && role !== "SUPERADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const invoices = await prisma.invoice.findMany({
    orderBy: { issuedAt: "desc" },
    include: { organization: { select: { name: true, vatId: true, marketCode: true } } },
  });

  const rows = invoices.map((inv) => ({
    invoice_id: inv.id,
    issued_at: inv.issuedAt?.toISOString() ?? "",
    due_at: inv.dueAt?.toISOString() ?? "",
    status: inv.status,
    currency: inv.currency,
    subtotal: Number(inv.subtotal),
    vat_pct: Number(inv.vatPct),
    total: Number(inv.total),
    org_name: inv.organization.name,
    org_vat_id: inv.organization.vatId ?? "",
    market: inv.organization.marketCode,
  }));

  await recordAudit(session?.user?.id ?? null, "export.invoices", "Invoice:*", {
    count: rows.length,
  });

  return new NextResponse(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="invoices-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
