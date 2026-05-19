import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import {
  tally,
  sumByGroup,
  averageOrderValue,
  conversionPct,
} from "@/lib/reporting";

export const dynamic = "force-dynamic";

export default async function DeskReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "reports" });
  const to = await getTranslations({ locale, namespace: "order" });

  const [requestCount, orders, orderLines, markets, invoices] =
    await Promise.all([
      prisma.request.count(),
      prisma.order.findMany({
        select: {
          status: true,
          quote: { select: { currency: true, total: true, subtotal: true } },
        },
      }),
      prisma.orderLine.findMany({ select: { productId: true } }),
      prisma.market.findMany({ select: { currency: true } }),
      prisma.invoice.findMany({ select: { status: true } }),
    ]);

  // KPIs grouped by currency so NOK/SEK/DKK never sum together.
  const currencies = [...new Set(markets.map((m) => m.currency))];
  const kpis = currencies
    .map((cur) => {
      const inCur = orders.filter((o) => o.quote.currency === cur);
      const gmv = inCur.reduce((s, o) => s + Number(o.quote.total), 0);
      return {
        currency: cur,
        count: inCur.length,
        gmv,
        aov: averageOrderValue(gmv, inCur.length),
      };
    })
    .filter((k) => k.count > 0);

  const statusRows = tally(orders.map((o) => o.status));

  const spendByCurrency = currencies
    .map((cur) => ({
      currency: cur,
      total: orders
        .filter((o) => o.quote.currency === cur)
        .reduce((s, o) => s + Number(o.quote.total), 0),
    }))
    .filter((r) => r.total > 0);

  const products = orderLines.length
    ? await prisma.product.findMany({
        where: { id: { in: orderLines.map((l) => l.productId) } },
        select: { id: true, title: { select: { category: true } } },
      })
    : [];
  const catById = new Map(products.map((p) => [p.id, p.title.category]));
  const categoryRows = tally(
    orderLines
      .map((l) => catById.get(l.productId))
      .filter((c): c is string => !!c),
  );

  const invoiceRows = sumByGroup(
    invoices.map((i) => ({ group: i.status, amount: 1 })),
  );

  return (
    <section>
      <p>
        <Link href="/desk">← {to("back")}</Link>
      </p>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <div className="grid">
        <article className="card">
          <h3>{t("requests")}</h3>
          <div className="price">{requestCount}</div>
        </article>
        <article className="card">
          <h3>{to("orders")}</h3>
          <div className="price">{orders.length}</div>
        </article>
        <article className="card">
          <h3>{t("conversion")}</h3>
          <div className="price">
            {conversionPct(requestCount, orders.length)}%
          </div>
        </article>
      </div>

      <h2 style={{ marginTop: 24 }}>{t("gmv")}</h2>
      {kpis.length === 0 ? (
        <p className="note">{t("none")}</p>
      ) : (
        <div className="grid">
          {kpis.map((k) => (
            <article className="card" key={k.currency}>
              <h3>{k.currency}</h3>
              <div className="muted">
                {t("gmv")}: {formatMoney(k.gmv, k.currency, locale)}
              </div>
              <div className="muted">
                {t("aov")}: {formatMoney(k.aov, k.currency, locale)}
              </div>
            </article>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>{t("byStatus")}</h2>
      <div className="card">
        {statusRows.length === 0 ? (
          <span className="muted">{t("none")}</span>
        ) : (
          statusRows.map((r) => (
            <div key={r.key} className="muted">
              {r.key}: {r.count}
            </div>
          ))
        )}
      </div>

      <h2 style={{ marginTop: 24 }}>{t("byMarket")}</h2>
      <div className="card">
        {spendByCurrency.length === 0 ? (
          <span className="muted">{t("none")}</span>
        ) : (
          spendByCurrency.map((r) => (
            <div key={r.currency} className="muted">
              {r.currency}: {formatMoney(r.total, r.currency, locale)}
            </div>
          ))
        )}
      </div>

      <h2 style={{ marginTop: 24 }}>{t("byCategory")}</h2>
      <div className="card">
        {categoryRows.length === 0 ? (
          <span className="muted">{t("none")}</span>
        ) : (
          categoryRows.map((r) => (
            <div key={r.key} className="muted">
              {r.key}: {r.count}
            </div>
          ))
        )}
      </div>

      <h2 style={{ marginTop: 24 }}>{t("invoices")}</h2>
      <div className="card">
        {invoiceRows.length === 0 ? (
          <span className="muted">{t("none")}</span>
        ) : (
          invoiceRows.map((r) => (
            <div key={r.group} className="muted">
              {r.group}: {r.amount}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
