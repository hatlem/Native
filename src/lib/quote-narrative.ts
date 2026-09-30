// Customer-facing quote narrative — the data layer for the quote page
// template. Purpose: turn the internal Quote (cost + margin per line)
// into a *buyer-facing* shape that supports the pricing levers laid
// out in PLAN.md and the desk's quote template:
//
//   1. One bundled all-in price per line (no cost / margin split).
//   2. Rate-card *anchor* per line ("Rate card €X → your price €Y")
//      so the customer reads the price as a discount, not a markup.
//   3. Outcome framing at the top, deliverable bullets per line so
//      the comparison set shifts from "publisher rate" to "what would
//      this cost me to assemble myself."
//
// Pure: no DB calls, no next-intl import. The page that uses this
// resolves the user-facing strings (labels, bullets, paragraphs) via
// the existing i18n layer. Anchor amounts scale with line quantity so
// the discount framing stays correct on multi-unit lines.

export type QuoteAnchor = {
  rateCard: number;
  currency: string;
};

export type QuoteNarrativeLine = {
  lineId: string;
  kind: "INVENTORY" | "CONTENT_FEE";
  // The placement's product; null on a content-fee line. The page reads
  // the format's spec (word count) through it.
  productId: string | null;
  // For a content-fee line: the title of the placement it produces the
  // article for, so the buyer can tell two "Content production" lines apart.
  titleName: string;
  productType: string;
  quantity: number;
  lineTotal: number;
  // "Pris på forespørsel" — the line is part of the offer but carries no
  // amount; the page renders a label instead of lineTotal and the anchor
  // discount framing is suppressed (there is no price to discount).
  priceOnRequest: boolean;
  anchor: QuoteAnchor | null;
};

export type QuoteNarrativeData = {
  orgName: string;
  itemCount: number;
  lines: QuoteNarrativeLine[];
};

type NarrativeQuoteLine = {
  id: string;
  kind?: "INVENTORY" | "CONTENT_FEE";
  // Null for CONTENT_FEE lines (production service, no placement).
  productId: string | null;
  // "Content production — <product name>" on a content-fee line (money.ts
  // computeContentFeeLines): the only link to the placement it belongs to.
  description?: string;
  lineTotal: unknown;
  quantity: number;
  priceOnRequest?: boolean;
};

// The content-fee description convention (money.ts computeContentFeeLines,
// also read by quote-pdf-data.ts): the fee names the sibling INVENTORY
// line's description, which is the product name it was priced under.
const CONTENT_FEE_PREFIX = "Content production — ";

type NarrativeQuote = {
  currency: string;
  lines: NarrativeQuoteLine[];
};

type NarrativeTitle = {
  name: string;
  publishedRateCard: unknown | null;
  publishedRateCurrency: string | null;
};

type NarrativeProduct = {
  type: string;
  title: NarrativeTitle;
};

export type BuildQuoteNarrativeInput = {
  quote: NarrativeQuote;
  organization: { name: string };
  productsById: Map<string, NarrativeProduct>;
};

export function buildQuoteNarrative(
  input: BuildQuoteNarrativeInput,
): QuoteNarrativeData {
  const { quote, organization, productsById } = input;

  // Placement description → its title's name, to label the fee lines.
  const titleByPlacementDescription = new Map<string, string>();
  for (const line of quote.lines) {
    if ((line.kind ?? "INVENTORY") !== "INVENTORY" || !line.productId || !line.description) continue;
    const title = productsById.get(line.productId)?.title;
    if (title) titleByPlacementDescription.set(line.description, title.name);
  }
  const feeTitleName = (line: NarrativeQuoteLine): string =>
    line.description?.startsWith(CONTENT_FEE_PREFIX)
      ? (titleByPlacementDescription.get(line.description.slice(CONTENT_FEE_PREFIX.length)) ?? "")
      : "";

  const lines: QuoteNarrativeLine[] = quote.lines.map((line) => {
    const kind = line.kind ?? "INVENTORY";
    const product = line.productId ? productsById.get(line.productId) : undefined;
    const title = product?.title;
    const rateCardPerUnit =
      title?.publishedRateCard != null ? Number(title.publishedRateCard) : null;

    // Content-fee lines carry no product or rate-card anchor — the page
    // labels them from productType ("CONTENT_FEE") under the title of the
    // placement they write for; with no matching placement the name stays
    // empty, so we never render a raw id.
    return {
      lineId: line.id,
      kind,
      productId: kind === "INVENTORY" ? line.productId : null,
      titleName: title?.name ?? (kind === "CONTENT_FEE" ? feeTitleName(line) : (line.productId ?? "")),
      productType:
        product?.type ?? (kind === "CONTENT_FEE" ? "CONTENT_FEE" : "NATIVE_ARTICLE"),
      quantity: line.quantity,
      lineTotal: Number(line.lineTotal),
      priceOnRequest: line.priceOnRequest ?? false,
      anchor:
        kind === "INVENTORY" &&
        !line.priceOnRequest &&
        rateCardPerUnit != null &&
        rateCardPerUnit > 0
          ? {
              rateCard: rateCardPerUnit * line.quantity,
              currency: title?.publishedRateCurrency ?? quote.currency,
            }
          : null,
    };
  });

  return {
    orgName: organization.name,
    itemCount: quote.lines.length,
    lines,
  };
}

// Discount percentage from anchor to line price. Returned as an integer
// 0-100 so the caller can render "−42% vs rate card". Returns null when
// the anchor is missing or doesn't actually exceed the line total (in
// which case showing a discount would mislead the buyer).
export function anchorDiscountPct(line: QuoteNarrativeLine): number | null {
  if (!line.anchor) return null;
  if (line.anchor.rateCard <= line.lineTotal) return null;
  return Math.round(
    ((line.anchor.rateCard - line.lineTotal) / line.anchor.rateCard) * 100,
  );
}
