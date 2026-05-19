import { getTranslations } from "next-intl/server";
import { MarketCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { readBasket } from "@/lib/basket";
import { indicativePrice, formatMoney } from "@/lib/money";
import { removeFromPlan, submitRequest } from "@/app/actions";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);

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
  const tr = await getTranslations({ locale, namespace: "rfq" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  const basket = await readBasket();
  const products = basket.length
    ? await prisma.product.findMany({
        where: { id: { in: basket.map((b) => b.productId) } },
        include: { title: true, priceRules: true },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines = basket
    .map((b) => {
      const p = byId.get(b.productId);
      if (!p) return null;
      const rule = p.priceRules[0];
      const unit = indicativePrice(
        Number(p.basePrice),
        rule ? Number(rule.marginPct) : 15,
        rule ? Number(rule.seasonalMultiplier) : 1,
      );
      return { product: p, quantity: b.quantity, lineTotal: unit * b.quantity };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const totals = new Map<string, number>();
  for (const l of lines) {
    totals.set(
      l.product.currency,
      (totals.get(l.product.currency) ?? 0) + l.lineTotal,
    );
  }

  return (
    <section>
      <h1>{t("title")}</h1>

      {sp.error ? <p className="note">{t("error")}</p> : null}

      {lines.length === 0 ? (
        <p>
          {t("empty")} <Link href="/catalog">{t("browse")}</Link>
        </p>
      ) : (
        <>
          <div className="grid">
            {lines.map((l) => (
              <article className="card" key={l.product.id}>
                <h3>{l.product.title.name}</h3>
                <div className="muted">{tType(l.product.type)}</div>
                <div className="muted">
                  {t("qty")}: {l.quantity}
                </div>
                <div className="price">
                  {formatMoney(l.lineTotal, l.product.currency, locale)}
                </div>
                <form action={removeFromPlan} style={{ marginTop: 10 }}>
                  <input type="hidden" name="locale" value={locale} />
                  <input
                    type="hidden"
                    name="productId"
                    value={l.product.id}
                  />
                  <button type="submit">{t("remove")}</button>
                </form>
              </article>
            ))}
          </div>

          <p className="note">
            {t("estTotal")}:{" "}
            {[...totals.entries()]
              .map(([cur, amt]) => formatMoney(amt, cur, locale))
              .join(" · ")}
          </p>

          <h2 style={{ marginTop: 32 }}>{t("rfqTitle")}</h2>
          <form action={submitRequest} className="filters">
            <input type="hidden" name="locale" value={locale} />
            <div>
              <label htmlFor="orgName">{tr("org")}</label>
              <input id="orgName" name="orgName" required />
            </div>
            <div>
              <label htmlFor="contactName">{tr("contactName")}</label>
              <input id="contactName" name="contactName" />
            </div>
            <div>
              <label htmlFor="contactEmail">{tr("contactEmail")}</label>
              <input
                id="contactEmail"
                name="contactEmail"
                type="email"
                required
              />
            </div>
            <div>
              <label htmlFor="market">{tr("market")}</label>
              <select id="market" name="market" defaultValue="">
                <option value="" disabled>
                  —
                </option>
                {MARKET_CODES.map((m) => (
                  <option key={m} value={m}>
                    {tMarket(m)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="budget">{tr("budget")}</label>
              <input id="budget" name="budget" type="number" min="0" />
            </div>
            <div>
              <label htmlFor="audience">{tr("audience")}</label>
              <input id="audience" name="audience" />
            </div>
            <div>
              <label htmlFor="goal">{tr("goal")}</label>
              <input id="goal" name="goal" />
            </div>
            <div>
              <label htmlFor="brief">{tr("brief")}</label>
              <input id="brief" name="brief" />
            </div>
            <button type="submit">{tr("submit")}</button>
          </form>
        </>
      )}
    </section>
  );
}
