// Invoice PDF — the buyer's copy of an issued invoice, rendered on demand
// from the Invoice row (never stored, so it needs no object storage and
// always matches what was billed). Readable by the billed organization, its
// agency, and the desk — the same guard as the /invoices/[id] page.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { recordAudit } from "@/lib/audit";
import { safeLocale } from "@/i18n/routing";
import { prisma } from "@/lib/prisma";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { InvoiceDocument } from "@/lib/pdf/InvoiceDocument";
import { loadInvoicePdfData } from "@/lib/pdf/invoice-pdf-data";
import { invoiceMessagesFor } from "@/lib/pdf/invoice-messages";
import { qt } from "@/lib/pdf/quote-messages";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params;
  const scope = await loadScope();
  if (!scope.userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const owner = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { organizationId: true },
  });
  // Another org's invoice answers exactly like a missing one — don't leak
  // that it exists.
  if (!owner || !canActOnOrg(scope, owner.organizationId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const locale = safeLocale(new URL(req.url).searchParams.get("locale"));
  const data = await loadInvoicePdfData(invoiceId, locale);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const messages = invoiceMessagesFor(locale);
  const buffer = await renderToBuffer(InvoiceDocument({ data, locale, messages }));

  await recordAudit(scope.userId, "invoice.pdf.download", `Invoice:${invoiceId}`, { locale });

  const filename = `${qt(messages, "documentTitle", { number: data.number })}.pdf`;
  const asciiFallback = filename.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
