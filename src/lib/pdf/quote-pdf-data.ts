import { prisma } from "@/lib/prisma";

// Everything a customer-facing quote PDF is allowed to render. No cost,
// margin, publisher sales-contact, or internal ID ever enters this shape —
// the PDF template only ever sees fields declared here, so a future template
// edit can't accidentally leak one by spreading a wider object.
export type QuotePdfRow = {
  titleName: string;
  marketCode: string;
  format: string;
  quantity: number;
  unitPrice: number | null;
  rowTotal: number | null;
  priceOnRequest: boolean;
  circulation: number | null;
  digitalReach: number | null;
  audience: string | null;
  vertical: string | null;
  frequency: string | null;
};

export type QuotePdfData = {
  quoteId: string;
  quoteNumber: string;
  currency: string;
  vatPct: number;
  subtotal: number;
  total: number;
  validUntil: Date | null;
  createdAt: Date;
  organizationName: string;
  preparedByName: string;
  preparedByEmail: string;
  rows: QuotePdfRow[];
};

// A CONTENT_FEE line has no productId (money.ts computeContentFeeLines) and
// carries `Content production — ${productName}` as its description — the
// same productName the sibling INVENTORY line was priced under
// (computeQuoteLines). That's the only link between the two rows at the
// data layer, so folding the fee into the customer-facing unit price means
// matching on that description convention.
const CONTENT_FEE_PREFIX = "Content production — ";

export async function loadQuotePdfData(
  quoteId: string,
  preparedBy: { name: string | null; email: string },
): Promise<QuotePdfData> {
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: {
      lines: true,
      request: { include: { organization: { select: { name: true } } } },
    },
  });

  const productIds = quote.lines
    .map((l) => l.productId)
    .filter((id): id is string => !!id);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      type: true,
      title: {
        select: {
          name: true,
          circulation: true,
          digitalReach: true,
          audience: true,
          vertical: true,
          frequency: true,
          market: { select: { code: true } },
        },
      },
    },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const contentFeeByProductName = new Map<string, number>();
  for (const line of quote.lines) {
    if (line.kind !== "CONTENT_FEE" || !line.description.startsWith(CONTENT_FEE_PREFIX)) continue;
    const productName = line.description.slice(CONTENT_FEE_PREFIX.length);
    contentFeeByProductName.set(
      productName,
      (contentFeeByProductName.get(productName) ?? 0) + Number(line.lineTotal),
    );
  }

  const rows: QuotePdfRow[] = quote.lines
    .filter((l) => l.kind === "INVENTORY")
    .map((l) => {
      const product = l.productId ? productById.get(l.productId) : undefined;
      const fee = contentFeeByProductName.get(l.description) ?? 0;
      const rowTotal = Number(l.lineTotal) + fee;
      // A "pris på forespørsel" line ships with no amount at all — the
      // stored lineTotal is an internal estimate the customer must never
      // see, so both figures are nulled, not just hidden by the template.
      const priceOnRequest = l.priceOnRequest;
      return {
        titleName: product?.title.name ?? l.description,
        marketCode: product?.title.market.code ?? "",
        format: product?.type ?? "",
        quantity: l.quantity,
        unitPrice: priceOnRequest
          ? null
          : l.quantity > 0
            ? rowTotal / l.quantity
            : rowTotal,
        rowTotal: priceOnRequest ? null : rowTotal,
        priceOnRequest,
        circulation: product?.title.circulation ?? null,
        digitalReach: product?.title.digitalReach ?? null,
        audience: product?.title.audience ?? null,
        vertical: product?.title.vertical ?? null,
        frequency: product?.title.frequency ?? null,
      };
    });

  return {
    quoteId: quote.id,
    quoteNumber: quote.id.slice(-8).toUpperCase(),
    currency: quote.currency,
    vatPct: Number(quote.vatPct),
    subtotal: Number(quote.subtotal),
    total: Number(quote.total),
    validUntil: quote.validUntil,
    createdAt: quote.createdAt,
    organizationName: quote.request.organization.name,
    preparedByName: preparedBy.name ?? "NativeSpin desk",
    preparedByEmail: preparedBy.email,
    rows,
  };
}
