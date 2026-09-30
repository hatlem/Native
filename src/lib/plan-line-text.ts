import { formatMoney } from "@/lib/money";
import type { LineDisplay } from "@/lib/plan-total";

// A message formatter: next-intl's getTranslations() on a page, or
// createTranslator() over the same message files where there is no request
// scope (the plan download). Either way the same ICU strings, plurals included.
export type Translate = (key: string, values?: Record<string, string | number>) => string;

export type BreakdownLine = {
  display: LineDisplay;
  quantity: number;
  withContent: boolean;
  // lib/authorship.ts publisherCanWrite: an unticked line is the publisher's
  // article, not copy the buyer owes.
  publisherCanWrite: boolean;
  currency: string;
};

// The transparency the single line figure lacks: what the line total is
// actually made of. Shared by /plan's line cards and the downloaded plan, so
// the two explain a figure in the same words.
//
// For an exact line the parts come from lib/plan-total.ts (the rule the order
// prices with), so they always add up to the line total shown beside them; the
// breakdown explains the figure, never adds to it. The content fee is charged
// once per line: one article, used for every run.
//
// A banded line gets no exact parts (they would give away the figure the band
// stands in for), only what the band covers: the quantity and whether the
// article is in it.
//
// `t` is the `plan` namespace, `tv` the `priceVisibility` one.
export function lineBreakdown(l: BreakdownLine, locale: string, t: Translate, tv: Translate): string {
  const d = l.display;
  if (d.kind === "onRequest") return t("breakdownUnpriced");
  if (d.kind === "rate") return tv("listIndicative");
  // Unticked on a placement the publisher's studio can write: the publisher
  // writes it (PUBLISHER_PRODUCED), so the line says so rather than looking
  // like the buyer owes us copy, also for a view-only seat, which sees no
  // choice buttons.
  const publisherWrites = !l.withContent && l.publisherCanWrite ? t("publisherWritesIt") : null;
  if (d.kind === "band") {
    const parts = [
      l.quantity > 1 ? t("breakdownPlacements", { n: l.quantity }) : null,
      d.withContent ? tv("productionIncluded") : publisherWrites,
      tv("listIndicative"),
    ];
    return parts.filter(Boolean).join(" · ");
  }
  const money = (n: number) => formatMoney(n, l.currency, locale);
  if (l.withContent && d.contentFee > 0) {
    return l.quantity > 1
      ? t("breakdownQtyWithArticleFee", {
          n: l.quantity,
          unit: money(d.placement / l.quantity),
          article: money(d.contentFee),
        })
      : t("breakdownWithArticle", { placement: money(d.placement), article: money(d.contentFee) });
  }
  if (l.withContent) {
    // "We write it" with no fee rule: production is included in the price.
    return l.quantity > 1
      ? t("breakdownQtyWithArticle", { n: l.quantity, unit: money(d.placement / l.quantity) })
      : t("breakdownArticleIncluded");
  }
  const qty = l.quantity > 1 ? t("breakdownQty", { n: l.quantity, unit: money(d.placement / l.quantity) }) : null;
  return [qty, publisherWrites].filter(Boolean).join(" · ");
}
