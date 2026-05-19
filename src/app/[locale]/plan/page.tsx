import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { readBasket } from "@/lib/basket";
import { indicativeFromRules, toRateRules, formatMoney } from "@/lib/money";
import { removeFromPlan, submitRequest } from "@/app/actions";

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

  const session = await auth();
  const me = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        include: { organization: true },
      })
    : null;
  const buyerOrg = me?.organization ?? null;

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
      const unit = indicativeFromRules(
        Number(p.basePrice),
        toRateRules(p.priceRules),
        b.quantity,
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

  const allFirm =
    lines.length > 0 && lines.every((l) => l.product.visibility === "FIRM");

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

          <h2 style={{ marginTop: 32 }}>
            {allFirm ? tf("planTitle") : t("rfqTitle")}
          </h2>
          {allFirm ? <p className="note">{tf("planNote")}</p> : null}
          {buyerOrg ? (
            <>
              <p className="muted">
                {tr("requestingAs")}: {buyerOrg.name}
              </p>
              <form action={submitRequest} className="filters">
                <input type="hidden" name="locale" value={locale} />
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
                <button type="submit">
                  {allFirm ? tf("planSubmit") : tr("submit")}
                </button>
              </form>
            </>
          ) : (
            <p className="note">
              {tr("loginRequired")}{" "}
              <Link href="/signin">{ta("signin")}</Link>
              {" · "}
              <Link href="/signup">{ta("signup")}</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
