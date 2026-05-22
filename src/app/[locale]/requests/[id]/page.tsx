import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { DataLayerEvent } from "@/app/data-layer-event";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { acceptQuote } from "@/app/actions";
import { StatusBadge } from "@/app/status-badge";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "requests" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tNav = await getTranslations({ locale, namespace: "nav" });
  const tp = await getTranslations({ locale, namespace: "production" });
  const ti = await getTranslations({ locale, namespace: "invoice" });

  const request = await prisma.request.findUnique({
    where: { id },
    include: {
      organization: true,
      plan: { include: { items: true } },
      quotes: {
        orderBy: { createdAt: "desc" },
        include: {
          lines: true,
          order: {
            include: {
              invoices: true,
              lines: {
                include: {
                  brief: {
                    include: {
                      assets: { orderBy: { version: "desc" }, take: 1 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!request) notFound();

  const session = await auth();
  const role = session?.user?.role;
  const isDesk = role === "DESK" || role === "SUPERADMIN";
  if (!isDesk) {
    const ws = await getWorkspace(session?.user?.id);
    if (!ws?.scopeOrgIds.includes(request.organizationId)) {
      notFound();
    }
  }

  const products = await prisma.product.findMany({
    where: { id: { in: request.plan.items.map((i) => i.productId) } },
    include: { title: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const quote = request.quotes[0];
  const order = quote?.order;
  const orderInvoice = order?.invoices[0];

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/requests" className="small-link">
          ← {t("listTitle")}
        </Link>
      </nav>

      <DataLayerEvent event="rfq_submitted" id={request.id} />
      {order ? (
        <DataLayerEvent
          event="order_confirmed"
          id={order.id}
          value={Number(quote.total)}
          currency={quote.currency}
        />
      ) : null}

      <header className="detail-head">
        <div>
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")} · {request.organization.name}</h1>
          <p className="lead">{request.plan.name}</p>
        </div>
        <aside className="detail-meta">
          <div className="meta-row">
            <span className="muted small">{t("status")}</span>
            <span className="value">
              <StatusBadge value={request.status} />
            </span>
          </div>
          <div className="meta-row">
            <span className="muted small">{t("items")}</span>
            <span className="value">{request.plan.items.length}</span>
          </div>
          {quote ? (
            <div className="meta-row">
              <span className="muted small">{t("total")}</span>
              <span className="value">
                {formatMoney(Number(quote.total), quote.currency, locale)}
              </span>
            </div>
          ) : null}
        </aside>
      </header>

      <section className="section">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("itemsEyebrow")}</span>
            <h2>{t("items")}</h2>
          </div>
        </div>
        <div className="grid">
          {request.plan.items.map((item) => {
            const p = byId.get(item.productId);
            return (
              <article className="card" key={item.id}>
                <h3>{p?.title.name ?? item.productId}</h3>
                <p className="muted">{p ? tType(p.type) : ""}</p>
                <span className="tag">× {item.quantity}</span>
              </article>
            );
          })}
        </div>
      </section>

      {!quote ? (
        <section className="section">
          <div className="empty">
            <div className="empty-icon">⏳</div>
            <h3 className="empty-title">{t("pendingTitle")}</h3>
            <p>{t("pending")}</p>
          </div>
        </section>
      ) : (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("quoteEyebrow")}</span>
              <h2>{t("quote")}</h2>
            </div>
            {quote.validUntil ? (
              <span className="muted small">
                {t("validUntil")}: {quote.validUntil.toISOString().slice(0, 10)}
              </span>
            ) : null}
          </div>
          <article className="card quote-card">
            <div className="quote-lines">
              {quote.lines.map((l) => (
                <div key={l.id} className="quote-line">
                  <span>
                    {l.description} <span className="muted">× {l.quantity}</span>
                  </span>
                  <span className="num">
                    {formatMoney(Number(l.lineTotal), quote.currency, locale)}
                  </span>
                </div>
              ))}
            </div>
            <div className="quote-totals">
              <div className="quote-row">
                <span className="muted">{t("subtotal")}</span>
                <span className="num">
                  {formatMoney(Number(quote.subtotal), quote.currency, locale)}
                </span>
              </div>
              <div className="quote-row">
                <span className="muted">
                  {t("vat")} ({Number(quote.vatPct)}%)
                </span>
                <span className="num">
                  {formatMoney(
                    Number(quote.total) - Number(quote.subtotal),
                    quote.currency,
                    locale,
                  )}
                </span>
              </div>
              <div className="quote-row total">
                <span>{t("total")}</span>
                <span className="num">
                  {formatMoney(Number(quote.total), quote.currency, locale)}
                </span>
              </div>
            </div>
            {order ? (
              <div className="banner-success" role="status">
                ✓ {t("accepted")} — {t("orderStatus")}:{" "}
                <StatusBadge value={order.status} />
              </div>
            ) : (
              <form action={acceptQuote} className="quote-cta">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="quoteId" value={quote.id} />
                <button type="submit" className="btn large">
                  {t("accept")}
                </button>
              </form>
            )}
          </article>
        </section>
      )}

      {order ? (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("orderEyebrow")}</span>
              <h2>
                {t("order")} <StatusBadge value={order.status} />
              </h2>
            </div>
            {orderInvoice ? (
              <Link
                href={`/invoices/${orderInvoice.id}`}
                className="btn small secondary"
              >
                {ti("title")} →
              </Link>
            ) : null}
          </div>
          <div className="grid">
            {order.lines.map((line) => {
              const p = byId.get(line.productId);
              const asset = line.brief?.assets[0];
              return (
                <article className="card" key={line.id}>
                  <h3>{p?.title.name ?? line.productId}</h3>
                  <p className="muted">{p ? tType(p.type) : ""}</p>
                  <div className="cluster tight">
                    {asset ? (
                      <>
                        <span className="muted small">{tp("status")}:</span>
                        <StatusBadge value={asset.status} />
                        {asset.specPassed === true ? (
                          <span className="badge badge-success dotless">
                            ✓
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="muted small">{tp("noAssets")}</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </>
  );
}
