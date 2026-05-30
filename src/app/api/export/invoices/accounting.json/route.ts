// Desk-only structured accounting export. Unlike invoices.csv (header-level
// rows), this emits the full vendor-neutral AccountingInvoice document per
// invoice — line items, derived VAT amount, customer VAT id — ready to
// import into an accounting system or feed a live provider integration.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { buildAccountingInvoice } from "@/lib/accounting";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "DESK" && role !== "SUPERADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const invoices = await prisma.invoice.findMany({
    orderBy: { issuedAt: "desc" },
    include: {
      lines: true,
      organization: { select: { id: true, name: true, vatId: true } },
    },
  });

  const docs = invoices.map((inv) =>
    buildAccountingInvoice(inv, inv.organization),
  );

  await recordAudit(session?.user?.id ?? null, "export.invoices.accounting", "Invoice:*", {
    count: docs.length,
  });

  return NextResponse.json(
    { invoices: docs },
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="accounting-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    },
  );
}
