import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { removeFromPlan, setQuantity, setContentProduction } from "@/app/plan-actions";
import { resolveTitleLine } from "@/app/list-actions";

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
        {lines.map((l) => (
          <div className="item plan-item" key={l.itemId}>
            <span className="tag">{tType(l.product.type)}</span>
            <div>
              <div className="title">{l.product.title.name}</div>
              <div className="sub plan-qty">
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
                  className={`btn small ${l.withContent ? "" : "ghost"}`}
                  aria-pressed={l.withContent}
                  title={t("contentProductionHint")}
                >
                  {l.withContent ? `✓ ${t("contentProduction")}` : `+ ${t("contentProduction")}`}
                </button>
              </form>
            </div>
            <div className="cluster tight">
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
        ))}

        {titleLines.map((tl) => (
          <div className="item plan-item" key={tl.itemId}>
            <span className="tag">{tReq("titlePlaceholderName")}</span>
            <div>
              <div className="title">{tl.titleName}</div>
              <div className="sub muted small">{t("titlePlaceholderNote")}</div>
              <div className="sub muted small">{t("qty")}: {tl.quantity}</div>
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
            <div className="cluster tight">
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
