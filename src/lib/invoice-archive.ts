// Keeps the invoice PDF as it was issued.
//
// The invoice row already freezes the figures, the customer and the seller
// (lib/invoice-snapshot.ts); this archives the rendered document itself in
// object storage, so the file the customer was sent can be produced again
// byte for byte — whatever happens to templates, fonts or translations later.
//
// Best-effort and optional: without R2 credentials (local dev, CI, previews)
// or while the seller details are incomplete, nothing is stored and the
// download route renders from the snapshot as before.

import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { marketDefaultLocale } from "@/lib/market-locale";
import { loadSellerDetails, sellerGaps } from "@/lib/seller";
import { sellerForInvoice } from "@/lib/invoice-snapshot";
import { getObjectBytes, isStorageConfigured, putObject } from "@/lib/storage/r2";

export const INVOICE_ARCHIVE_PREFIX = "invoices";

// Statuses whose archived copy is still the current document. A credited
// invoice is rendered live instead, because it then also states the credit.
const ARCHIVE_SERVED_FOR = new Set(["ISSUED", "PAID", "OVERDUE"]);

export function servesArchivedPdf(invoice: { status: string; pdfObjectKey: string | null }): boolean {
  return Boolean(invoice.pdfObjectKey) && ARCHIVE_SERVED_FOR.has(invoice.status);
}

// Render the invoice in the customer's language and store it. Returns the
// object key, or null when nothing was archived. Never throws.
export async function archiveInvoicePdf(invoiceId: string): Promise<string | null> {
  if (!isStorageConfigured()) return null;
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        number: true,
        pdfObjectKey: true,
        organization: { select: { marketCode: true } },
      },
    });
    if (!invoice) return null;
    if (invoice.pdfObjectKey) return invoice.pdfObjectKey;

    const locale = marketDefaultLocale(invoice.organization.marketCode ?? "");
    // Loaded lazily: the PDF renderer is heavy and only needed when storage
    // is configured.
    const [{ renderToBuffer }, { InvoiceDocument }, { loadInvoicePdfData }, { invoiceMessagesFor }] =
      await Promise.all([
        import("@react-pdf/renderer"),
        import("@/lib/pdf/InvoiceDocument"),
        import("@/lib/pdf/invoice-pdf-data"),
        import("@/lib/pdf/invoice-messages"),
      ]);
    const data = await loadInvoicePdfData(invoiceId, locale);
    if (!data) return null;
    const seller = sellerForInvoice(data.sellerSnapshot, loadSellerDetails());
    // A legally incomplete document is never archived; the route refuses to
    // render it too, and archives on the first successful download instead.
    if (sellerGaps(seller, data.currency).length > 0) return null;

    const buffer = await renderToBuffer(
      InvoiceDocument({ data, seller, locale, messages: invoiceMessagesFor(locale) }),
    );
    const { key } = await putObject({
      prefix: INVOICE_ARCHIVE_PREFIX,
      filename: `invoice-${data.number}-${locale}.pdf`,
      contentType: "application/pdf",
      body: Buffer.from(buffer),
    });
    // Only the first archive wins; a concurrent one leaves an orphan object,
    // never a second "original".
    const claimed = await prisma.invoice.updateMany({
      where: { id: invoiceId, pdfObjectKey: null },
      data: { pdfObjectKey: key },
    });
    if (claimed.count !== 1) {
      const existing = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { pdfObjectKey: true },
      });
      return existing?.pdfObjectKey ?? null;
    }
    return key;
  } catch (err) {
    log.error("invoice.archive_failed", { invoiceId, err });
    return null;
  }
}

// The archived bytes, or null when they can't be read (storage down, object
// gone) — the caller then renders from the snapshot.
export async function readArchivedInvoicePdf(key: string): Promise<Uint8Array | null> {
  if (!isStorageConfigured()) return null;
  try {
    return await getObjectBytes(key);
  } catch (err) {
    log.error("invoice.archive_read_failed", { key, err });
    return null;
  }
}
