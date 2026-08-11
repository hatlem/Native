import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { formatMoney, intlLocale } from "@/lib/money";
import { titleDisplayName } from "@/lib/title-display";
import { removeFromPlan, setQuantity, setContentProduction } from "@/app/plan-actions";
import { resolveTitleLine } from "@/app/list-actions";
import { inclusionLines, type ProductInclusions } from "@/lib/pricing/inclusions";

type PlanProduct = Prisma.ProductGetPayload<{
  include: {
    title: { include: { publisher: true } };
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

// "How long is this on for" — the buyer's own chosen period if they've been
// through the Schedule step, else the desk-confirmed sold duration, else the
// publisher's stated minimum commitment. Never invents a number none of the
// three sources actually gave us.
function periodLine(
  l: Pick<PlanLine, "scheduleStart" | "scheduleUnits" | "product">,
  tPlan: Awaited<ReturnType<typeof getTranslations>>,
  tDetail: Awaited<ReturnType<typeof getTranslations>>,
  tCampaign: Awaited<ReturnType<typeof getTranslations>>,
  locale: string,
): string | null {
  const unit = l.product.bookingUnit;
  const unitLabel = unit === "WEEK" ? tCampaign("unitWeeks") : tCampaign("unitMonths");

  if (l.scheduleStart && l.scheduleUnits) {
    const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
      day: "numeric",
      month: "short",
      ...(unit === "MONTH" ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
    return tPlan("scheduledPeriod", {
      date: dateFmt.format(new Date(l.scheduleStart)),
      n: l.scheduleUnits,
      unit: unitLabel,
    });
  }

  const inc = l.product.inclusions as ProductInclusions | null;
  if (inc?.durationWeeks) return tDetail("inc.duration", { weeks: inc.durationWeeks });

  if (l.product.minDurationUnits) {
    return tCampaign("minRun", { n: l.product.minDurationUnits, unit: unitLabel });
  }

  return null;
}

// Short "what's on" summary — up to 2 facts, e.g. "Forsidepromotering ·
// Nyhetsbrev". inclusionLines() always pushes the duration fact last, so
// when periodLine() already surfaced it via inc.durationWeeks, drop that
// trailing entry here rather than repeating the same sentence twice.
function includedSummary(
  inc: ProductInclusions | null,
  tDetail: Awaited<ReturnType<typeof getTranslations>>,
  currency: string,
  durationAlreadyShown: boolean,
): string | null {
  if (!inc) return null;
  let facts = inclusionLines(inc, tDetail, currency);
  if (durationAlreadyShown && inc.durationWeeks) facts = facts.slice(0, -1);
  if (!facts.length) return null;
  return facts.slice(0, 2).join(" · ");
}

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

// Left column of the split: the basket line list with quantity
// steppers, content-production toggle and remove buttons, plus the
// title-placeholder rows.
export async function PlanLines({
  locale,
  lines,
  titleLines,
  hasHiddenPrice,
}: {
  locale: string;
  lines: PlanLine[];
  titleLines: PlanTitleLine[];
  hasHiddenPrice: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tReq = await getTranslations({ locale, namespace: "requests" });
  const tDetail = await getTranslations({ locale, namespace: "titleDetail" });
  const tCampaign = await getTranslations({ locale, namespace: "campaign" });
  const tv = await getTranslations({
    locale,
    namespace: "priceVisibility",
  });

  const count = lines.length + titleLines.length;

  return (
    <div>
      <div className="section-head">
        <div>
          <span className="eyebrow">{t("linesEyebrow")}</span>
          <h2>{t("linesHeading")}</h2>
        </div>
        <span className="muted small">
          {t("itemCount", { count })}
        </span>
      </div>
      {hasHiddenPrice ? (
        <div className="banner-info" role="status">
          <span>{tv("planRfqOnly")}</span>
        </div>
      ) : null}
      <div className="action-list">
        {lines.map((l) => {
          const period = periodLine(l, t, tDetail, tCampaign, locale);
          const included = includedSummary(
            l.product.inclusions as ProductInclusions | null,
            tDetail,
            l.product.currency,
            period !== null,
          );
          return (
            <div className={`item plan-item${l.unavailable ? " plan-item-unavailable" : ""}`} key={l.itemId}>
              <span className="tag" title={tType(`desc${l.product.type}`)}>
                {tType(l.product.type)}
              </span>
              <div>
                <div className="title">{titleDisplayName(l.product.title)}</div>
                {l.unavailable ? (
                  <div className="sub plan-line-unavailable" role="alert">
                    {t("lineUnavailable")}
                  </div>
                ) : null}
                {period || included ? (
                  <div className="sub muted small">
                    {[period, included].filter(Boolean).join(" · ")}
                  </div>
                ) : null}
              </div>
              <div className="plan-line-controls">
                <div className="plan-qty">
                  <form action={setQuantity} className="plan-qty-step">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="itemId" value={l.itemId} />
                    <input type="hidden" name="quantity" value={l.quantity - 1} />
                    <button type="submit" className="btn small ghost" aria-label={t("decrement")} disabled={l.quantity <= 1}>−</button>
                  </form>
                  <span aria-live="polite">{t("qty")}: {l.quantity}</span>
                  <form action={setQuantity} className="plan-qty-step">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="itemId" value={l.itemId} />
                    <input type="hidden" name="quantity" value={l.quantity + 1} />
                    <button type="submit" className="btn small ghost" aria-label={t("increment")}>+</button>
                  </form>
                </div>
                <form action={setContentProduction} className="plan-content-toggle">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="itemId" value={l.itemId} />
                  <input type="hidden" name="withContent" value={l.withContent ? "0" : "1"} />
                  <button
                    type="submit"
                    className={`btn small plan-content-btn ${l.withContent ? "" : "ghost"}`}
                    aria-pressed={l.withContent}
                    title={t("contentProductionHint")}
                  >
                    {l.withContent ? `✓ ${t("contentProduction")}` : `+ ${t("contentProduction")}`}
                  </button>
                </form>
              </div>
              <div className="plan-line-actions">
                {l.priceVisible ? (
                  <span className="price plan-line-price">
                    {formatMoney(l.lineTotal, l.product.currency, locale)}
                  </span>
                ) : (
                  <span className="muted small plan-line-price">
                    {tv("requestPrice")}
                  </span>
                )}
                <form action={removeFromPlan}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="itemId" value={l.itemId} />
                  <button type="submit" className="btn small ghost">
                    {t("remove")}
                  </button>
                </form>
              </div>
            </div>
          );
        })}

        {titleLines.map((tl) => (
          <div className="item plan-item" key={tl.itemId}>
            <span className="tag">{tReq("titlePlaceholderName")}</span>
            <div>
              <div className="title">{tl.titleName}</div>
              <div className="sub muted small">{t("titlePlaceholderNote")}</div>
              <div className="sub muted small">{t("qty")}: {tl.quantity}</div>
            </div>
            <div className="plan-line-controls">
              {tl.placements.length > 0 ? (
                <form action={resolveTitleLine} className="plan-content-toggle">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="itemId" value={tl.itemId} />
                  <select name="productId" defaultValue="" aria-label={t("pickPlacement")}>
                    <option value="" disabled>{t("pickPlacement")}</option>
                    {tl.placements.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                  <button type="submit" className="btn small">{t("resolve")}</button>
                </form>
              ) : (
                <div className="sub muted small">{t("noPlacements")}</div>
              )}
            </div>
            <div className="plan-line-actions">
              <span className="muted small plan-line-price">
                {tv("requestPrice")}
              </span>
              <form action={removeFromPlan}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="itemId" value={tl.itemId} />
                <button type="submit" className="btn small ghost">
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
