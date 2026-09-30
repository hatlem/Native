// Editable quote (.docx), rendered on demand from the frozen Quote (never
// re-priced, never stored): the numbers are identical to any PDF version.
// The desk adjusts wording in Word or LibreOffice before sending; the
// owning buyer downloads their sent quote to circulate for internal
// approval. Access rules: lib/pdf/quote-download.ts.

import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { safeLocale } from "@/i18n/routing";
import { loadScope } from "@/lib/scope";
import { renderQuoteDocx } from "@/lib/pdf/quote-docx";
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
  const buffer = await renderQuoteDocx(data, locale, messages);

  await recordAudit(access.userId, "quote.docx.export", `Quote:${quoteId}`, {
    locale,
    audience: access.audience,
  });

  const filename = `${qt(messages, "documentTitle", { quoteNumber: data.quoteNumber })}.docx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": attachmentDisposition(filename),
      "Cache-Control": "private, no-store",
    },
  });
}
