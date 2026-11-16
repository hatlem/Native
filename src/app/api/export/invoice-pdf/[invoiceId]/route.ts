import { log } from "@/lib/log";
// Invoice PDF — the buyer's copy of an issued invoice. When the document was
// archived at issue (lib/invoice-archive.ts, needs object storage) that exact
// file is served; otherwise it is rendered on demand from the Invoice row and
// its frozen customer/seller blocks, so it always matches what was billed.
// Readable by the billed organization, its agency, and the desk — the same
// guard as the /invoices/[id] page.

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
import { loadSellerDetails, sellerGaps } from "@/lib/seller";
import { documentNumber, sellerForInvoice } from "@/lib/invoice-snapshot";
import { archiveInvoicePdf, readArchivedInvoicePdf, servesArchivedPdf } from "@/lib/invoice-archive";

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
    select: { organizationId: true, status: true, pdfObjectKey: true, number: true, id: true },
  });
  // Another org's invoice answers exactly like a missing one — don't leak
  // that it exists.
  if (!owner || !canActOnOrg(scope, owner.organizationId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const locale = safeLocale(new URL(req.url).searchParams.get("locale"));

  // The document as issued, when it was archived. A credited invoice is
  // rendered live instead, so the copy also states the credit.
  if (owner.pdfObjectKey && servesArchivedPdf(owner)) {
    const archived = await readArchivedInvoicePdf(owner.pdfObjectKey);
    if (archived) {
      await recordAudit(scope.userId, "invoice.pdf.download", `Invoice:${invoiceId}`, {
        locale,
        archived: true,
      });
      return pdfResponse(
        archived,
        `${qt(invoiceMessagesFor(locale), "documentTitle", { number: documentNumber(owner) })}.pdf`,
      );
    }
  }

  const data = await loadInvoicePdfData(invoiceId, locale);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Never issue a legally incomplete invoice: without the seller's org/VAT
  // number, address and payment details the document is not a valid sales
  // document. The invoice pages hide the download (and tell the desk which
  // variables to set) in this state; this is the backstop for direct hits.
  // The seller block frozen at issue time, completed from today's config.
  const seller = sellerForInvoice(data.sellerSnapshot, loadSellerDetails());
  const gaps = sellerGaps(seller, data.currency);
  if (gaps.length > 0) {
    log.error("invoice.pdf.seller_incomplete", { invoiceId, gaps });
    return NextResponse.json(
      {
        error: "seller_details_incomplete",
        message: "The invoice PDF is unavailable until NativeSpin's seller details are configured.",
        // Variable names only (never values) — and only to the desk.
        ...(scope.isDesk ? { missing: gaps } : {}),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const messages = invoiceMessagesFor(locale);
  const buffer = await renderToBuffer(InvoiceDocument({ data, seller, locale, messages }));

  await recordAudit(scope.userId, "invoice.pdf.download", `Invoice:${invoiceId}`, { locale });

  // An issued invoice that was never archived (storage or seller details
  // were not configured at issue) is archived now, on its first good render.
  if (!owner.pdfObjectKey && servesArchivedPdf({ status: owner.status, pdfObjectKey: "pending" })) {
    await archiveInvoicePdf(invoiceId);
  }

  return pdfResponse(new Uint8Array(buffer), `${qt(messages, "documentTitle", { number: data.number })}.pdf`);
}

function pdfResponse(bytes: Uint8Array, filename: string): NextResponse {
  const asciiFallback = filename.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
