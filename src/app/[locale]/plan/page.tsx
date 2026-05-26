import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { Link } from "@/i18n/navigation";
import { readBasket } from "@/lib/basket";
import { indicativeFromRules, toRateRules, formatMoney } from "@/lib/money";
import { arePricesVisible } from "@/lib/pricing-visibility";
import { removeFromPlan, submitRequest } from "@/app/actions";
import { EmptyState } from "@/app/empty-state";

export const dynamic = "force-dynamic";

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "plan" });
  const tf = await getTranslations({ locale, namespace: "firm" });
  const tr = await getTranslations({ locale, namespace: "rfq" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const ta = await getTranslations({ locale, namespace: "auth" });
  const tNav = await getTranslations({ locale, namespace: "nav" });
  const tv = await getTranslations({
    locale,
    namespace: "priceVisibility",
  });

  const session = await auth();
  const ws = await getWorkspace(session?.user?.id);
  const activeOrg = ws?.activeOrgId
    ? await prisma.organization.findUnique({
        where: { id: ws.activeOrgId },
        select: { name: true },
      })
    : null;
  const needsClient = !!ws?.isAgency && !ws.activeOrgId;

  const basket = await readBasket();
  const products = basket.length
    ? await prisma.product.findMany({
        where: { id: { in: basket.map((b) => b.productId) } },
        include: {
          title: { include: { publisher: true } },
          priceRules: true,
        },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines = basket
    .map((b) => {
      const p = byId.get(b.productId);
      if (!p) return null;
      const priceVisible = arePricesVisible(p.title);
      const unit = priceVisible
        ? indicativeFromRules(
            Number(p.basePrice),
            toRateRules(p.priceRules),
            b.quantity,
          )
        : 0;
      return {
        product: p,
        quantity: b.quantity,
        priceVisible,
        lineTotal: unit * b.quantity,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const hasHiddenPrice = lines.some((l) => !l.priceVisible);

  const totals = new Map<string, number>();
  for (const l of lines) {
    if (!l.priceVisible) continue;
    totals.set(
      l.product.currency,
      (totals.get(l.product.currency) ?? 0) + l.lineTotal,
    );
  }

  // A hidden-price line forces the whole basket onto the RFQ path —
  // we can't checkout firm against a price the buyer hasn't seen.
  const allFirm =
    lines.length > 0 &&
    !hasHiddenPrice &&
    lines.every((l) => l.product.visibility === "FIRM");

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      {sp.error ? (
        <div className="banner-error" role="alert">
          <span>{t("error")}</span>
        </div>
      ) : null}

      {/* Surfaced by duplicatePlan (Maja R2 / "use as template") so the
          buyer knows how many items survived the rehydration. */}
      {typeof sp.duplicate === "string" ? (
        sp.duplicate === "ok" ? (
          <div className="banner-info" role="status">
            <span>{t("duplicateOk")}</span>
          </div>
        ) : sp.duplicate.startsWith("partial-") ? (
          <div className="banner-info" role="status">
            <span>
              {t("duplicatePartial", {
                dropped: sp.duplicate.slice("partial-".length),
              })}
            </span>
          </div>
        ) : sp.duplicate === "all-inactive" ? (
          <div className="banner-error" role="alert">
            <span>{t("duplicateAllInactive")}</span>
          </div>
        ) : null
      ) : null}

      {lines.length === 0 ? (
        <EmptyState
          title={t("empty")}
          primaryHref="/catalog"
          primaryLabel={t("browse")}
          secondaryHref="/recommend"
          secondaryLabel={tNav("recommend")}
        />
      ) : (
        <div className="split">
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
                    <div className="sub">
                      {t("qty")}: {l.quantity}
                    </div>
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
                      <input
                        type="hidden"
                        name="productId"
                        value={l.product.id}
                      />
                      <button type="submit" className="btn small ghost">
                        {t("remove")}
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="plan-summary">
            <div className="plan-summary-head">
              <span className="muted small">{t("estTotal")}</span>
              <div className="plan-summary-total">
                {[...totals.entries()].map(([cur, amt]) => (
                  <div className="price" key={cur}>
                    {formatMoney(amt, cur, locale)}
                  </div>
                ))}
              </div>
              {allFirm ? (
                <span className="badge badge-info dotless">
                  ⚡ {tf("badge")}
                </span>
              ) : null}
            </div>

            <h3>{allFirm ? tf("planTitle") : t("rfqTitle")}</h3>
            {allFirm ? <p className="muted small">{tf("planNote")}</p> : null}

            {needsClient ? (
              <p className="muted small">
                {tr("selectClient")}{" "}
                <Link href="/agency" className="link">
                  {tNav("agency")}
                </Link>
              </p>
            ) : activeOrg ? (
              <form action={submitRequest} className="product-form">
                <input type="hidden" name="locale" value={locale} />
                <p className="muted small">
                  {tr("requestingAs")}: <strong>{activeOrg.name}</strong>
                </p>
                <div className="field">
                  <label htmlFor="budget">{tr("budget")}</label>
                  <input id="budget" name="budget" type="number" min="0" />
                </div>
                <div className="field">
                  <label htmlFor="audience">{tr("audience")}</label>
                  <input id="audience" name="audience" />
                </div>
                <div className="field">
                  <label htmlFor="goal">{tr("goal")}</label>
                  <input id="goal" name="goal" />
                </div>
                <div className="field">
                  <label htmlFor="brief">{tr("brief")}</label>
                  <textarea id="brief" name="brief" rows={3} />
                </div>
                <button type="submit" className="btn block">
                  {allFirm ? tf("planSubmit") : tr("submit")}
                </button>
              </form>
            ) : (
              <div className="auth-fallback">
                <p className="muted small">{tr("loginRequired")}</p>
                <div className="cluster">
                  <Link href="/signin" className="btn small secondary">
                    {ta("signin")}
                  </Link>
                  <Link href="/signup" className="btn small">
                    {ta("signup")}
                  </Link>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
