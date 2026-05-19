import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { tally, averageOrderValue } from "@/lib/reporting";

export const dynamic = "force-dynamic";

export default async function MyReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "reports" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const session = await auth();
  const me = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { organizationId: true },
      })
    : null;
  if (!me?.organizationId) {
    redirect(`/${locale}/signin`);
  }

  const orders = await prisma.order.findMany({
    where: { organizationId: me.organizationId },
    select: {
      status: true,
      quote: { select: { currency: true, total: true } },
      lines: { select: { productId: true } },
    },
  });

  const byCurrency = [
    ...new Set(orders.map((o) => o.quote.currency)),
  ].map((cur) => {
    const inCur = orders.filter((o) => o.quote.currency === cur);
    const spend = inCur.reduce((s, o) => s + Number(o.quote.total), 0);
    return {
      currency: cur,
      count: inCur.length,
      spend,
      aov: averageOrderValue(spend, inCur.length),
    };
  });

  const statusRows = tally(orders.map((o) => o.status));

  const productIds = orders.flatMap((o) => o.lines.map((l) => l.productId));
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: { select: { category: true } } },
      })
    : [];
  const catById = new Map(products.map((p) => [p.id, p.title.category]));
  const categoryRows = tally(
    productIds
      .map((id) => catById.get(id))
      .filter((c): c is string => !!c),
  );

  return (
    <section>
      <h1>{t("mySpend")}</h1>
      <p className="muted">{t("mySubtitle")}</p>

      {orders.length === 0 ? (
        <p>
          {t("none")} <Link href="/catalog">{tNav("catalog")}</Link>
        </p>
      ) : (
        <>
          <div className="grid">
            {byCurrency.map((c) => (
              <article className="card" key={c.currency}>
                <h3>{c.currency}</h3>
                <div className="muted">
                  {t("orders")}: {c.count}
                </div>
                <div className="muted">
                  {t("gmv")}: {formatMoney(c.spend, c.currency, locale)}
                </div>
                <div className="muted">
                  {t("aov")}: {formatMoney(c.aov, c.currency, locale)}
                </div>
              </article>
            ))}
          </div>

          <h2 style={{ marginTop: 24 }}>{t("byStatus")}</h2>
          <div className="card">
            {statusRows.map((r) => (
              <div key={r.key} className="muted">
                {r.key}: {r.count}
              </div>
            ))}
          </div>

          <h2 style={{ marginTop: 24 }}>{t("byCategory")}</h2>
          <div className="card">
            {categoryRows.map((r) => (
              <div key={r.key} className="muted">
                {r.key}: {r.count}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
