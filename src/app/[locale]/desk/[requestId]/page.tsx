import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { generateQuote } from "@/app/actions";
import { StatusBadge } from "@/app/status-badge";

export const dynamic = "force-dynamic";

export default async function DeskRequestPage({
  params,
}: {
  params: Promise<{ locale: string; requestId: string }>;
}) {
  const { locale, requestId } = await params;
  const t = await getTranslations({ locale, namespace: "desk" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      organization: true,
      plan: { include: { items: true } },
      quotes: {
        orderBy: { createdAt: "desc" },
        include: { lines: true, order: true },
      },
    },
  });
  if (!request) notFound();

  const products = await prisma.product.findMany({
    where: { id: { in: request.plan.items.map((i) => i.productId) } },
    include: { title: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const quote = request.quotes[0];

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/desk" className="small-link">
          ← {t("title")}
        </Link>
      </nav>

      <header className="detail-head">
        <div>
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>
            {t("request")} · {request.organization.name}
          </h1>
          {request.briefSummary ? (
            <p className="lead">{request.briefSummary}</p>
          ) : null}
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
            <span className="eyebrow">{t("briefEyebrow")}</span>
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
          <div className="cta-block">
            <h2>{t("readyToQuoteTitle")}</h2>
            <p className="muted">{t("readyToQuoteBody")}</p>
            <form action={generateQuote}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="requestId" value={request.id} />
              <button type="submit" className="btn large">
                {t("generate")}
              </button>
            </form>
          </div>
        </section>
      ) : (
        <section className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t("quoteEyebrow")}</span>
              <h2>{t("quote")}</h2>
            </div>
            {quote.order ? (
              <Link
                href={`/desk/orders/${quote.order.id}`}
                className="btn small secondary"
              >
                {t("openOrder")} →
              </Link>
            ) : null}
          </div>
          <article className="card quote-card">
            <div className="quote-lines">
              {quote.lines.map((l) => (
                <div key={l.id} className="quote-line">
                  <span>
                    {l.description}{" "}
                    <span className="muted">
                      × {l.quantity} · margin {Number(l.marginPct)}%
                    </span>
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
            {quote.order ? (
              <div className="banner-success" role="status">
                ✓ {t("acceptedOrder")}
              </div>
            ) : (
              <div className="quote-cta">
                <span className="muted small">{t("awaiting")}</span>
              </div>
            )}
          </article>
        </section>
      )}
    </>
  );
}
