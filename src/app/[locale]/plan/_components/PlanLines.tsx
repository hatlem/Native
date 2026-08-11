import { getTranslations } from "next-intl/server";
import { Calendar } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { formatMoney, intlLocale } from "@/lib/money";
import { titleDisplayName } from "@/lib/title-display";
import { removeFromPlan, setQuantity, setContentProduction } from "@/app/plan-actions";
import { resolveTitleLine } from "@/app/list-actions";
import { pickContentFeeRule, contentFeeAmount, type ContentFeeRuleSpec } from "@/lib/money";

type PlanProduct = Prisma.ProductGetPayload<{
  include: {
    title: { include: { publisher: true; market: true } };
    priceRules: true;
  };
}>;

// One product row as assembled in page.tsx: a SavedListItem keyed on its
// concrete product, with the price already resolved against the
// visibility gate. Edits post the item id (not the product id).
export type PlanLine = {
  itemId: string;
  product: PlanProduct;
  quantity: number;
  priceVisible: boolean;
  withContent: boolean;
  lineTotal: number;
  // Product deactivated since it was added — flagged so the buyer removes it
  // (submit refuses while it's present, instead of silently dropping it).
  unavailable: boolean;
  // Buyer-chosen booking period, set via the campaign flow's Schedule step.
  // Null for lines added straight from /plan or the catalog — most of them.
  scheduleStart: Date | null;
  scheduleUnits: number | null;
};

// A publication placeholder: a SavedListItem that references a Title but no
// product yet. The desk proposes a placement, or the buyer picks one from
// the title's active+bookable products.
export type PlanTitleLine = {
  itemId: string;
  titleId: string;
  titleName: string;
  quantity: number;
  placements: { id: string; label: string }[];
};

function periodLabel(
  l: Pick<PlanLine, "scheduleStart" | "scheduleUnits" | "product">,
  tCampaign: Awaited<ReturnType<typeof getTranslations>>,
  locale: string,
): string | null {
  if (!l.scheduleStart || !l.scheduleUnits) return null;
  const unit = l.product.bookingUnit;
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    ...(unit === "MONTH" ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
  return dateFmt.format(new Date(l.scheduleStart));
}

// The transparency the single total figure lacks: what the line total is
// actually made of. Only the pieces we can compute indicatively pre-quote —
// the content fee is desk-owned pricing looked up the same way the formal
// quote will (pickContentFeeRule), not invented here.
function breakdown(
  l: PlanLine,
  feeRules: ContentFeeRuleSpec[],
  locale: string,
  t: Awaited<ReturnType<typeof getTranslations>>,
): string {
  if (!l.priceVisible) return t("breakdownUnpriced");
  if (l.withContent) {
    const rule = pickContentFeeRule(feeRules, l.product.type, l.product.title.market.code);
    if (rule) {
      const fee = Math.round(contentFeeAmount(rule));
      const placement = l.lineTotal;
      return t("breakdownWithArticle", {
        placement: formatMoney(placement, l.product.currency, locale),
        article: formatMoney(fee, l.product.currency, locale),
      });
    }
    if (l.quantity > 1) {
      return t("breakdownQtyWithArticle", {
        n: l.quantity,
        unit: formatMoney(l.lineTotal / l.quantity, l.product.currency, locale),
      });
    }
    return t("breakdownArticleIncluded");
  }
  if (l.quantity > 1) {
    return t("breakdownQty", {
      n: l.quantity,
      unit: formatMoney(l.lineTotal / l.quantity, l.product.currency, locale),
    });
  }
  return "";
}

// Left column of the split: the basket line list with quantity
// steppers, content-production toggle and remove buttons, plus the
// title-placeholder rows.
export async function PlanLines({
  locale,
  lines,
  titleLines,
  hasHiddenPrice,
  feeRules,
}: {
  locale: string;
  lines: PlanLine[];
  titleLines: PlanTitleLine[];
  hasHiddenPrice: boolean;
  feeRules: ContentFeeRuleSpec[];
}) {
  const t = await getTranslations({ locale, namespace: "plan" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tReq = await getTranslations({ locale, namespace: "requests" });
  const tCampaign = await getTranslations({ locale, namespace: "campaign" });
  const tv = await getTranslations({ locale, namespace: "priceVisibility" });

  const count = lines.length + titleLines.length;

  return (
    <div>
      <div className="plan-lines-head">
        <span className="plan-lines-eyebrow">{t("itemCount", { count })}</span>
        <Link href="/catalog" className="btn small secondary">
          {t("addMoreTitles")}
        </Link>
      </div>
      {hasHiddenPrice ? (
        <div className="banner-info" role="status">
          <span>{tv("planRfqOnly")}</span>
        </div>
      ) : null}
      <div className="plan-line-list">
        {lines.map((l) => {
          const reach = l.product.title.digitalReach ?? l.product.title.monthlyReach ?? null;
          const period = periodLabel(l, tCampaign, locale);
          const isFirm = l.product.visibility === "FIRM";
          return (
            <div
              className={`plan-line-card${l.unavailable ? " plan-line-card--unavailable" : ""}${
                !l.priceVisible ? " plan-line-card--needs-price" : ""
              }`}
              key={l.itemId}
            >
              <div className="plan-line-card__main">
                <div className="plan-line-card__title-row">
                  <span className="plan-line-card__title">{titleDisplayName(l.product.title)}</span>
                  {!l.priceVisible ? (
                    <span className="badge badge-warning dotless plan-line-card__pill">{t("needsPrice")}</span>
                  ) : isFirm ? (
                    <span className="badge badge-success dotless plan-line-card__pill">⚡ {t("instantBook")}</span>
                  ) : null}
                </div>
                <div className="plan-line-card__meta">
                  {tType(l.product.type)} · {l.product.title.publisher.name}
                  {reach ? ` · ${t("readers", { count: new Intl.NumberFormat(intlLocale(locale)).format(reach) })}` : ""}
                </div>
                {l.unavailable ? (
                  <div className="plan-line-card__unavailable" role="alert">
                    {t("lineUnavailable")}
                  </div>
                ) : null}
                <div className="plan-line-card__controls">
                  <div className="plan-qty-stepper">
                    <form action={setQuantity}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="itemId" value={l.itemId} />
                      <input type="hidden" name="quantity" value={l.quantity - 1} />
                      <button type="submit" aria-label={t("decrement")} disabled={l.quantity <= 1}>
                        −
                      </button>
                    </form>
                    <span aria-live="polite">{l.quantity}</span>
                    <form action={setQuantity}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="itemId" value={l.itemId} />
                      <input type="hidden" name="quantity" value={l.quantity + 1} />
                      <button type="submit" aria-label={t("increment")}>
                        +
                      </button>
                    </form>
                  </div>
                  <Link href="/campaign?step=schedule" className="plan-line-card__schedule">
                    <Calendar size={14} strokeWidth={1.7} aria-hidden="true" />
                    {period ?? t("setDates")}
                  </Link>
                </div>
              </div>

              <div className="plan-line-card__price">
                {l.priceVisible ? (
                  <span className="plan-line-card__total">{formatMoney(l.lineTotal, l.product.currency, locale)}</span>
                ) : (
                  <span className="plan-line-card__total plan-line-card__total--muted">{tv("requestPrice")}</span>
                )}
                <span className="plan-line-card__breakdown">{breakdown(l, feeRules, locale, t)}</span>
              </div>

              <div className="plan-line-card__actions">
                <form action={setContentProduction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="itemId" value={l.itemId} />
                  <input type="hidden" name="withContent" value={l.withContent ? "0" : "1"} />
                  {/* A real submit <button>, not an <input type="checkbox"> — this
                      file is server-only (form actions, no client JS), and a
                      genuine checkbox would need an onChange handler to submit
                      on click. Styled with a checkbox-shaped indicator instead. */}
                  <button
                    type="submit"
                    className="plan-line-card__write-check"
                    aria-pressed={l.withContent}
                  >
                    <span className="plan-line-card__write-check-box" aria-hidden="true">
                      {l.withContent ? "✓" : ""}
                    </span>
                    {t("weWriteIt")}
                  </button>
                </form>
                <form action={removeFromPlan}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="itemId" value={l.itemId} />
                  <button type="submit" className="plan-line-card__remove">
                    {t("remove")}
                  </button>
                </form>
              </div>

              {!l.priceVisible ? (
                <div className="plan-line-card__price-note">{t("needsPriceNote")}</div>
              ) : null}
            </div>
          );
        })}

        {titleLines.map((tl) => (
          <div className="plan-line-card plan-line-card--placeholder" key={tl.itemId}>
            <div className="plan-line-card__main">
              <div className="plan-line-card__title-row">
                <span className="plan-line-card__title">{tl.titleName}</span>
                <span className="badge badge-neutral dotless plan-line-card__pill">
                  {tReq("titlePlaceholderName")}
                </span>
              </div>
              <div className="plan-line-card__meta">{t("titlePlaceholderNote")}</div>
              <div className="plan-line-card__controls">
                {tl.placements.length > 0 ? (
                  <form action={resolveTitleLine} className="plan-line-card__resolve">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="itemId" value={tl.itemId} />
                    <select name="productId" defaultValue="" aria-label={t("pickPlacement")}>
                      <option value="" disabled>
                        {t("pickPlacement")}
                      </option>
                      {tl.placements.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="btn small">
                      {t("resolve")}
                    </button>
                  </form>
                ) : (
                  <span className="muted small">{t("noPlacements")}</span>
                )}
              </div>
            </div>
            <div className="plan-line-card__price">
              <span className="plan-line-card__total plan-line-card__total--muted">{tv("requestPrice")}</span>
            </div>
            <div className="plan-line-card__actions">
              <form action={removeFromPlan}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="itemId" value={tl.itemId} />
                <button type="submit" className="plan-line-card__remove">
                  {t("remove")}
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
