import { createTranslator, type AbstractIntlMessages } from "next-intl";
import { prisma } from "@/lib/prisma";
import { safeLocale } from "@/i18n/routing";
import { articleScope, articleScopeLines, type Translate } from "@/lib/article-scope";
import { loadExtraWorkRates } from "@/lib/content-fee";
import daMessages from "@/messages/da.json";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import fiMessages from "@/messages/fi.json";
import noMessages from "@/messages/no.json";
import svMessages from "@/messages/sv.json";
import { lineOrder } from "@/lib/commerce/line-order";
import { paymentTermsDaysFor } from "@/lib/payment-terms";
import { marketTimeZone } from "@/lib/markets";
import { quoteOnlineUrl } from "./quote-online-url";

// Everything a customer-facing quote PDF is allowed to render. No cost,
// margin, publisher sales-contact, or internal ID ever enters this shape —
// the PDF template only ever sees fields declared here, so a future template
// edit can't accidentally leak one by spreading a wider object.
export type QuotePdfRow = {
  // A publisher placement (with any article fee folded in), or desk-billed
  // extra hours (titleName is then the desk's description of the work).
  kind: "PLACEMENT" | "EXTRA_WORK";
  titleName: string;
  marketCode: string;
  // Raw ProductType enum value; renderers localize it via quoteFormatLabel.
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
  // Customer-visible line note ("Merknad"), plain text. Null when unset.
  customerNote: string | null;
  // The article fee folded into this placement row (an article NativeSpin
  // writes), shown as "incl. article ... from X". Null when there is none or
  // the row is priced on request.
  articleFee: number | null;
  // EXTRA_WORK rows: hours x rate. Null on a placement row.
  hours: number | null;
  hourlyRate: number | null;
};

// What an article NativeSpin writes includes (lib/article-scope.ts), already
// in the document's language. One entry per distinct scope: normally one;
// several only when the placements' specs differ (e.g. word counts), each
// then naming the titles it applies to.
export type QuotePdfArticleScope = { titles: string[]; lines: string[] };

export type QuotePdfData = {
  quoteId: string;
  quoteNumber: string;
  currency: string;
  vatPct: number;
  subtotal: number;
  total: number;
  validUntil: Date | null;
  createdAt: Date;
  // The buyer organisation's zone (marketTimeZone): the document prints its
  // dates as days on the buyer's calendar, like the quote page does.
  timeZone: string;
  organizationName: string;
  preparedByName: string;
  preparedByEmail: string;
  // Absolute link to the buyer's live quote page — see quote-online-url.ts.
  onlineUrl: string;
  // The customer's agreed terms (lib/payment-terms.ts), stated on the
  // document so quote and invoice can't disagree.
  paymentTermsDays: number;
  // Set on a revision (lib/commerce/quote-revision.ts): the document says
  // which revision it is and which quote number it replaces, so a customer
  // holding both copies can tell which one counts. Null for a first quote.
  revision: { number: number; replacesQuoteNumber: string } | null;
  rows: QuotePdfRow[];
  // Empty when no row carries an article fee.
  articleScopes: QuotePdfArticleScope[];
};

const MESSAGES = { da: daMessages, de: deMessages, en: enMessages, fi: fiMessages, no: noMessages, sv: svMessages };

// next-intl outside a request (a route handler renders the documents): the
// same ICU strings, plurals included, that the quote page uses.
function scopeTranslator(locale: string): Translate {
  const appLocale = safeLocale(locale);
  const messages = MESSAGES[appLocale] as unknown as AbstractIntlMessages;
  return createTranslator({ locale: appLocale, messages, namespace: "articleScope" }) as Translate;
}

// The customer-facing quote number: the tail of the id, upper-cased.
export function quoteNumberFor(quoteId: string): string {
  return quoteId.slice(-8).toUpperCase();
}

// A CONTENT_FEE line has no productId (money.ts computeContentFeeLines) and
// carries `Content production — ${productName}` as its description — the
// same productName the sibling INVENTORY line was priced under
// (computeQuoteLines). That's the only link between the two rows at the
// data layer, so folding the fee into the customer-facing unit price means
// matching on that description convention.
const CONTENT_FEE_PREFIX = "Content production — ";

/**
 * The quote was replaced by a sent revision (SUPERSEDED): it is no longer an
 * offer, so no new customer document is rendered from it — the desk would be
 * handing out numbers the customer can't accept. PDF versions made while it
 * was live stay downloadable as history.
 */
export class QuoteSupersededError extends Error {
  constructor(readonly quoteId: string) {
    super(`Quote ${quoteId} is superseded by a revision`);
    this.name = "QuoteSupersededError";
  }
}

export async function loadQuotePdfData(
  quoteId: string,
  preparedBy: { name: string | null; email: string },
  locale: string,
): Promise<QuotePdfData> {
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: {
      lines: { orderBy: lineOrder() },
      request: {
        include: {
          organization: { select: { name: true, paymentTermsDays: true, marketCode: true } },
        },
      },
    },
  });
  // Both renderers (PDF and DOCX) load through here, so this is the one gate.
  if (quote.status === "SUPERSEDED") throw new QuoteSupersededError(quote.id);

  const productIds = quote.lines
    .map((l) => l.productId)
    .filter((id): id is string => !!id);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      type: true,
      // The article scope: word count and marking from the spec, stated
      // revision rounds from the offer's inclusions.
      inclusions: true,
      spec: { select: { wordCountMin: true, wordCountMax: true, disclosureLabel: true } },
      title: {
        select: {
          name: true,
          circulation: true,
          digitalReach: true,
          audience: true,
          vertical: true,
          frequency: true,
          market: { select: { code: true, disclosureLabel: true } },
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

  const rates = await loadExtraWorkRates();
  const t = scopeTranslator(locale);
  const scopeByKey = new Map<string, QuotePdfArticleScope>();

  const rows: QuotePdfRow[] = quote.lines
    .filter((l) => l.kind === "INVENTORY" || l.kind === "EXTRA_WORK")
    .map((l): QuotePdfRow => {
      if (l.kind === "EXTRA_WORK") {
        const lineTotal = Number(l.lineTotal);
        return {
          kind: "EXTRA_WORK",
          titleName: l.description,
          marketCode: "",
          format: "",
          quantity: 1,
          unitPrice: l.priceOnRequest ? null : lineTotal,
          rowTotal: l.priceOnRequest ? null : lineTotal,
          priceOnRequest: l.priceOnRequest,
          circulation: null,
          digitalReach: null,
          audience: null,
          vertical: null,
          frequency: null,
          customerNote: l.customerNote,
          articleFee: null,
          hours: l.hours != null ? Number(l.hours) : null,
          hourlyRate: l.hourlyRate != null ? Number(l.hourlyRate) : null,
        };
      }
      const product = l.productId ? productById.get(l.productId) : undefined;
      const fee = contentFeeByProductName.get(l.description) ?? 0;
      const rowTotal = Number(l.lineTotal) + fee;
      // A "pris på forespørsel" line ships with no amount at all — the
      // stored lineTotal is an internal estimate the customer must never
      // see, so both figures are nulled, not just hidden by the template.
      const priceOnRequest = l.priceOnRequest;
      if (fee > 0) {
        const lines = articleScopeLines(articleScope(product, quote.currency, rates), t, locale);
        const key = lines.join("\n");
        const scope = scopeByKey.get(key) ?? { titles: [], lines };
        const titleName = product?.title.name ?? l.description;
        if (!scope.titles.includes(titleName)) scope.titles.push(titleName);
        scopeByKey.set(key, scope);
      }
      return {
        kind: "PLACEMENT",
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
        customerNote: l.customerNote,
        articleFee: fee > 0 && !priceOnRequest ? fee : null,
        hours: null,
        hourlyRate: null,
      };
    });

  return {
    quoteId: quote.id,
    quoteNumber: quoteNumberFor(quote.id),
    currency: quote.currency,
    vatPct: Number(quote.vatPct),
    subtotal: Number(quote.subtotal),
    total: Number(quote.total),
    validUntil: quote.validUntil,
    createdAt: quote.createdAt,
    timeZone: marketTimeZone(quote.request.organization.marketCode),
    organizationName: quote.request.organization.name,
    preparedByName: preparedBy.name ?? "NativeSpin desk",
    preparedByEmail: preparedBy.email,
    onlineUrl: quoteOnlineUrl(quote.requestId, locale),
    paymentTermsDays: paymentTermsDaysFor(quote.request.organization),
    revision: quote.previousQuoteId
      ? { number: quote.revision, replacesQuoteNumber: quoteNumberFor(quote.previousQuoteId) }
      : null,
    rows,
    articleScopes: [...scopeByKey.values()],
  };
}
