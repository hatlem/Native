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

import { feePlacementDescription, placementCount } from "@/lib/commerce/placements";

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
  // For a content-fee line: the format of the placement it writes for, so two
  // fee lines on the same title ("Aftenposten · Content production") can be
  // told apart. Null on a placement line, or when no placement matches.
  forProductType: string | null;
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

  // Placement description → its product, to label the fee lines.
  const placementByDescription = new Map<string, NarrativeProduct>();
  for (const line of quote.lines) {
    if ((line.kind ?? "INVENTORY") !== "INVENTORY" || !line.productId || !line.description) continue;
    const product = productsById.get(line.productId);
    if (product) placementByDescription.set(line.description, product);
  }
  // The fee names its placement's description (lib/commerce/placements.ts).
  const feePlacement = (line: NarrativeQuoteLine): NarrativeProduct | undefined => {
    const name = line.description ? feePlacementDescription(line.description) : null;
    return name === null ? undefined : placementByDescription.get(name);
  };

  const lines: QuoteNarrativeLine[] = quote.lines.map((line) => {
    const kind = line.kind ?? "INVENTORY";
    const product = line.productId ? productsById.get(line.productId) : undefined;
    const title = product?.title;
    const rateCardPerUnit =
      title?.publishedRateCard != null ? Number(title.publishedRateCard) : null;
    const placement = kind === "CONTENT_FEE" ? feePlacement(line) : undefined;

    // Content-fee lines carry no product or rate-card anchor — the page
    // labels them from productType ("CONTENT_FEE") under the title of the
    // placement they write for; with no matching placement the name stays
    // empty, so we never render a raw id.
    return {
      lineId: line.id,
      kind,
      productId: kind === "INVENTORY" ? line.productId : null,
      titleName: title?.name ?? (kind === "CONTENT_FEE" ? (placement?.title.name ?? "") : (line.productId ?? "")),
      productType:
        product?.type ?? (kind === "CONTENT_FEE" ? "CONTENT_FEE" : "NATIVE_ARTICLE"),
      forProductType: placement?.type ?? null,
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
    // Placements only: a content-fee line bills the article for a placement
    // and is not one itself (lib/commerce/placements.ts).
    itemCount: placementCount(quote.lines),
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
