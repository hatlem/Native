import { prisma } from "@/lib/prisma";
import { lineOrder } from "@/lib/commerce/line-order";
import { invoiceLineLabel } from "@/lib/invoice-line-label";
import { formatMoney, intlLocale } from "@/lib/money";
import { qt, quoteFormatLabel } from "./quote-messages";
import { invoiceMessagesFor } from "./invoice-messages";

// Everything the invoice PDF may render. Built from the issued Invoice row
// (never re-derived from the quote), so the document always matches what
// was billed. No cost, margin or internal user data enters this shape.
export type InvoicePdfRow = {
  label: string;
  quantity: number;
  unitAmount: number;
  lineTotal: number;
};

export type InvoicePdfData = {
  invoiceId: string;
  number: string;
  status: string;
  currency: string;
  subtotal: number;
  vatPct: number;
  total: number;
  issuedAt: Date | null;
  dueAt: Date | null;
  accountingNumber: string | null;
  // The terms the invoice was issued under (null on legacy invoices).
  paymentTermsDays: number | null;
  customer: { name: string; vatId: string | null; addressLines: string[] };
  rows: InvoicePdfRow[];
  credit: { issuedAt: Date; amount: number; reason: string } | null;
};

// Same short form the invoice page shows.
export function invoiceNumber(invoiceId: string): string {
  return invoiceId.slice(-8).toUpperCase();
}

export async function loadInvoicePdfData(
  invoiceId: string,
  locale: string,
): Promise<InvoicePdfData | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lines: { orderBy: lineOrder() },
      organization: {
        select: {
          name: true,
          legalName: true,
          vatId: true,
          addressLine1: true,
          addressLine2: true,
          postalCode: true,
          city: true,
        },
      },
      creditNotes: { orderBy: { issuedAt: "asc" }, take: 1 },
    },
  });
  if (!invoice) return null;

  const messages = invoiceMessagesFor(locale);
  const deps = {
    formatLabel: (type: string) => quoteFormatLabel(type, locale),
    contentProduction: qt(messages, "contentProduction"),
    extraWork: qt(messages, "extraWork"),
    extraWorkDetail: (hours: number, rate: number) =>
      qt(messages, "extraWorkDetail", {
        hours: new Intl.NumberFormat(intlLocale(locale)).format(hours),
        rate: formatMoney(rate, invoice.currency, locale),
      }),
  };
  const credit = invoice.creditNotes[0];
  const org = invoice.organization;

  return {
    invoiceId: invoice.id,
    number: invoiceNumber(invoice.id),
    status: invoice.status,
    currency: invoice.currency,
    subtotal: Number(invoice.subtotal),
    vatPct: Number(invoice.vatPct),
    total: Number(invoice.total),
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    accountingNumber: invoice.accountingNumber,
    paymentTermsDays: invoice.paymentTermsDays,
    customer: {
      // The billing block collected in the campaign flow, when present.
      name: org.legalName || org.name,
      vatId: org.vatId,
      addressLines: [
        org.addressLine1,
        org.addressLine2,
        [org.postalCode, org.city].filter(Boolean).join(" "),
      ].filter((l): l is string => Boolean(l && l.trim())),
    },
    rows: invoice.lines.map((l) => ({
      label: invoiceLineLabel(l, deps),
      quantity: l.quantity,
      unitAmount: Number(l.unitAmount),
      lineTotal: Number(l.lineTotal),
    })),
    credit: credit
      ? { issuedAt: credit.issuedAt, amount: Number(credit.amount), reason: credit.reason }
      : null,
  };
}
