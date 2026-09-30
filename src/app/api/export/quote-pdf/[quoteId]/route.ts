// Quote PDF, rendered on demand from the frozen Quote, the same document
// the desk's "Generate PDF" stores as a version, minus the storage: it
// needs no object storage (R2), so a buyer can always download the offer
// they're looking at, and it always matches the quote page. Access rules
// (desk, or the owning org once sent): lib/pdf/quote-download.ts.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { recordAudit } from "@/lib/audit";
import { safeLocale } from "@/i18n/routing";
import { loadScope } from "@/lib/scope";
import { QuoteDocument } from "@/lib/pdf/QuoteDocument";
import { loadQuotePdfData } from "@/lib/pdf/quote-pdf-data";
import { qt, quoteMessagesFor } from "@/lib/pdf/quote-messages";
import { attachmentDisposition, authorizeQuoteDownload } from "@/lib/pdf/quote-download";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const { quoteId } = await params;
  const access = await authorizeQuoteDownload(await loadScope(), quoteId);
  if (!access.ok) return access.response;

  const locale = safeLocale(new URL(req.url).searchParams.get("locale"));
  const messages = quoteMessagesFor(locale);
  const data = await loadQuotePdfData(quoteId, access.preparedBy, locale);
  const buffer = await renderToBuffer(QuoteDocument({ data, locale, messages }));

  await recordAudit(access.userId, "quote.pdf.download", `Quote:${quoteId}`, {
    locale,
    audience: access.audience,
  });

  const filename = `${qt(messages, "documentTitle", { quoteNumber: data.quoteNumber })}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachmentDisposition(filename),
      "Cache-Control": "private, no-store",
    },
  });
}
