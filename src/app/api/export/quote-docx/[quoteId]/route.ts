// Editable quote (.docx) — desk-only, like generating the PDF. Rendered on
// demand from the frozen Quote (never re-priced, never stored): the numbers
// are identical to any PDF version, and the desk can adjust wording in Word
// or LibreOffice before sending it to the buyer.

import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { safeLocale } from "@/i18n/routing";
import { prisma } from "@/lib/prisma";
import { loadScope } from "@/lib/scope";
import { renderQuoteDocx } from "@/lib/pdf/quote-docx";
import { loadQuotePdfData } from "@/lib/pdf/quote-pdf-data";
import { qt, quoteMessagesFor } from "@/lib/pdf/quote-messages";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const { quoteId } = await params;
  const scope = await loadScope();
  if (!scope.userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!scope.isDesk) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const exists = await prisma.quote.findUnique({ where: { id: quoteId }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const locale = safeLocale(new URL(req.url).searchParams.get("locale"));
  const messages = quoteMessagesFor(locale);
  const data = await loadQuotePdfData(
    quoteId,
    {
      name: scope.session?.user?.name ?? null,
      email: scope.session?.user?.email ?? "desk@nativespin.com",
    },
    locale,
  );
  const buffer = await renderQuoteDocx(data, locale, messages);

  await recordAudit(scope.userId, "quote.docx.export", `Quote:${quoteId}`, { locale });

  const filename = `${qt(messages, "documentTitle", { quoteNumber: data.quoteNumber })}.docx`;
  const asciiFallback = filename.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
