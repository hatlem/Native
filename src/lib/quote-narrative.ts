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
  titleName: string;
  productType: string;
  quantity: number;
  lineTotal: number;
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
  lineTotal: unknown;
  quantity: number;
};

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

  const lines: QuoteNarrativeLine[] = quote.lines.map((line) => {
    const kind = line.kind ?? "INVENTORY";
    const product = line.productId ? productsById.get(line.productId) : undefined;
    const title = product?.title;
    const rateCardPerUnit =
      title?.publishedRateCard != null ? Number(title.publishedRateCard) : null;

    // Content-fee lines carry no product or rate-card anchor — the page
    // labels them from productType ("CONTENT_FEE"). titleName stays empty
    // so we never render a raw id.
    return {
      lineId: line.id,
      kind,
      titleName: title?.name ?? (kind === "CONTENT_FEE" ? "" : (line.productId ?? "")),
      productType:
        product?.type ?? (kind === "CONTENT_FEE" ? "CONTENT_FEE" : "NATIVE_ARTICLE"),
      quantity: line.quantity,
      lineTotal: Number(line.lineTotal),
      anchor:
        kind === "INVENTORY" && rateCardPerUnit != null && rateCardPerUnit > 0
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
