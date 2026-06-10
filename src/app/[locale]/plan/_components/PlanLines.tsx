import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { removeFromPlan, setQuantity, setContentProduction } from "@/app/plan-actions";

type PlanProduct = Prisma.ProductGetPayload<{
  include: {
    title: { include: { publisher: true } };
    priceRules: true;
  };
}>;

// One basket row as assembled in page.tsx: product + cookie quantity,
// with the price already resolved against the visibility gate.
export type PlanLine = {
  product: PlanProduct;
  quantity: number;
  priceVisible: boolean;
  withContent: boolean;
  lineTotal: number;
};

// Left column of the split: the basket line list with quantity
// steppers, content-production toggle and remove buttons.
export async function PlanLines({
  locale,
  lines,
  hasHiddenPrice,
}: {
  locale: string;
  lines: PlanLine[];
  hasHiddenPrice: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "plan" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tv = await getTranslations({
    locale,
    namespace: "priceVisibility",
  });

  return (
    <div>
      <div className="section-head">
        <div>
          <span className="eyebrow">{t("linesEyebrow")}</span>
          <h2>{t("linesHeading")}</h2>
        </div>
        <span className="muted small">
          {t("itemCount", { count: lines.length })}
        </span>
      </div>
      {hasHiddenPrice ? (
        <div className="banner-info" role="status">
          <span>{tv("planRfqOnly")}</span>
        </div>
      ) : null}
      <div className="action-list">
        {lines.map((l) => (
          <div className="item plan-item" key={l.product.id}>
            <span className="tag">{tType(l.product.type)}</span>
            <div>
              <div className="title">{l.product.title.name}</div>
              <div className="sub plan-qty">
                <form action={setQuantity} className="plan-qty-step">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="productId" value={l.product.id} />
                  <input type="hidden" name="quantity" value={l.quantity - 1} />
                  <button type="submit" className="btn small ghost" aria-label={t("decrement")} disabled={l.quantity <= 1}>−</button>
                </form>
                <span aria-live="polite">{t("qty")}: {l.quantity}</span>
                <form action={setQuantity} className="plan-qty-step">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="productId" value={l.product.id} />
                  <input type="hidden" name="quantity" value={l.quantity + 1} />
                  <button type="submit" className="btn small ghost" aria-label={t("increment")}>+</button>
                </form>
              </div>
              <form action={setContentProduction} className="plan-content-toggle">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="productId" value={l.product.id} />
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
                <input type="hidden" name="productId" value={l.product.id} />
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
