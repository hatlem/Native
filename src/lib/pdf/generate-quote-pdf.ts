import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { putObject } from "@/lib/storage/r2";
import { loadQuotePdfData } from "./quote-pdf-data";
import { QuoteDocument } from "./QuoteDocument";
import enMessages from "@/messages/en.json";
import noMessages from "@/messages/no.json";

const PDF_MESSAGES: Record<string, Record<string, string>> = {
  en: enMessages.quotePdf,
  no: noMessages.quotePdf,
};

function messagesFor(locale: string): Record<string, string> {
  return PDF_MESSAGES[locale] ?? PDF_MESSAGES.en;
}

// Renders the CURRENT frozen Quote data as a new customer-safe PDF, uploads
// it to R2, and records it as the next version for this quote. Never
// re-prices — QuoteLine.unitCost/lineTotal are read as already computed by
// generateQuote and never touched here, so re-generating a PDF (a new date
// on the cover, a fixed typo) can never change the numbers the buyer already
// saw quoted.
export async function generateQuotePdf(args: {
  quoteId: string;
  locale: string;
  generatedById: string;
  preparedBy: { name: string | null; email: string };
}): Promise<{ id: string; version: number; objectKey: string }> {
  const data = await loadQuotePdfData(args.quoteId, args.preparedBy);
  const messages = messagesFor(args.locale);
  const buffer = await renderToBuffer(
    QuoteDocument({ data, locale: args.locale, messages }),
  );

  const lastVersion = await prisma.quoteDocument.findFirst({
    where: { quoteId: args.quoteId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (lastVersion?.version ?? 0) + 1;

  const { key } = await putObject({
    prefix: `quote-pdfs/${args.quoteId}`,
    filename: `${data.quoteNumber}-v${version}.pdf`,
    contentType: "application/pdf",
    body: Buffer.from(buffer),
  });

  const doc = await prisma.quoteDocument.create({
    data: {
      quoteId: args.quoteId,
      version,
      locale: args.locale,
      objectKey: key,
      generatedById: args.generatedById,
    },
  });

  return { id: doc.id, version: doc.version, objectKey: doc.objectKey };
}
