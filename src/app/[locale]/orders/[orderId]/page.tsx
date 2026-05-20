import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { loadScope, canActOnOrg } from "@/lib/scope";
import { StatusBadge } from "@/app/status-badge";

export const dynamic = "force-dynamic";

// Per-order buyer view: status timeline, per-line content + booking
// progress, links to invoice. Org-scoped via canActOnOrg.
export default async function MyOrderPage({
  params,
}: {
  params: Promise<{ locale: string; orderId: string }>;
}) {
  const { locale, orderId } = await params;
  const t = await getTranslations({ locale, namespace: "orders" });
  const to = await getTranslations({ locale, namespace: "order" });
  const tp = await getTranslations({ locale, namespace: "production" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const ti = await getTranslations({ locale, namespace: "invoice" });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      quote: true,
      invoices: { select: { id: true, status: true } },
      lines: {
        include: {
          brief: { include: { assets: { orderBy: { version: "desc" }, take: 1 } } },
          booking: true,
        },
      },
    },
  });
  if (!order) notFound();

  const scope = await loadScope();
  if (!canActOnOrg(scope, order.organizationId)) notFound();

  const products = await prisma.product.findMany({
    where: { id: { in: order.lines.map((l) => l.productId) } },
    include: { title: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  return (
    <section>
      <p>
        <Link href="/orders">← {t("title")}</Link>
      </p>
      <h1>
        {to("title")} #{order.id.slice(-8).toUpperCase()}
      </h1>
      <p className="muted">
        {to("status")}: <StatusBadge value={order.status} />
      </p>
      <p className="price">
        {formatMoney(Number(order.quote.total), order.quote.currency, locale)}
      </p>

      <h2 style={{ marginTop: 16 }}>{to("lines")}</h2>
      <div className="grid">
        {order.lines.map((line) => {
          const p = byId.get(line.productId);
          const latest = line.brief?.assets[0];
          return (
            <article className="card" key={line.id}>
              <h3>{p?.title.name ?? line.productId}</h3>
              <div className="muted">{p ? tType(p.type) : ""}</div>
              <div className="muted">
                {tp("status")}:{" "}
                {latest ? (
                  <StatusBadge value={latest.status} />
                ) : (
                  tp("noAssets")
                )}
                {latest?.specPassed === true ? " · ✅" : null}
              </div>
              {line.booking ? (
                <div className="muted">
                  {t("booking")}: <StatusBadge value={line.booking.status} />
                  {line.booking.liveUrl ? (
                    <>
                      {" · "}
                      <a
                        href={line.booking.liveUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {t("livePlacement")} →
                      </a>
                    </>
                  ) : null}
                </div>
              ) : null}
              <div className="muted" style={{ marginTop: 6 }}>
                {formatMoney(
                  Number(line.lineTotal),
                  order.quote.currency,
                  locale,
                )}
              </div>
            </article>
          );
        })}
      </div>

      {order.invoices[0] ? (
        <p className="note" style={{ marginTop: 20 }}>
          <Link href={`/invoices/${order.invoices[0].id}`}>{ti("title")} →</Link>
        </p>
      ) : null}
    </section>
  );
}
