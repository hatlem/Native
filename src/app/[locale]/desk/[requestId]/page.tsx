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
    <section>
      <p>
        <Link href="/desk">← {t("title")}</Link>
      </p>
      <h1>
        {t("request")} · {request.organization.name}
      </h1>
      <p className="muted">
        {t("status")}: <StatusBadge value={request.status} />
      </p>
      {request.briefSummary ? (
        <p className="muted">
          {t("brief")}: {request.briefSummary}
        </p>
      ) : null}

      <h2 style={{ marginTop: 20 }}>{t("items")}</h2>
      <div className="grid">
        {request.plan.items.map((item) => {
          const p = byId.get(item.productId);
          return (
            <article className="card" key={item.id}>
              <h3>{p?.title.name ?? item.productId}</h3>
              <div className="muted">{p ? tType(p.type) : ""}</div>
              <div className="muted">× {item.quantity}</div>
            </article>
          );
        })}
      </div>

      {!quote ? (
        <form action={generateQuote} style={{ marginTop: 20 }}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="requestId" value={request.id} />
          <button type="submit" className="btn" style={{ marginTop: 0 }}>
            {t("generate")}
          </button>
        </form>
      ) : (
        <>
          <h2 style={{ marginTop: 20 }}>{t("quote")}</h2>
          <div className="card">
            {quote.lines.map((l) => (
              <div key={l.id} className="muted">
                {l.description} × {l.quantity} ({Number(l.marginPct)}%) —{" "}
                {formatMoney(Number(l.lineTotal), quote.currency, locale)}
              </div>
            ))}
            <div style={{ marginTop: 10 }}>
              {t("subtotal")}:{" "}
              {formatMoney(Number(quote.subtotal), quote.currency, locale)}
              <br />
              {t("vat")} ({Number(quote.vatPct)}%)
              <br />
              <span className="price">
                {t("total")}:{" "}
                {formatMoney(Number(quote.total), quote.currency, locale)}
              </span>
            </div>
            <p className="note">
              {quote.order ? (
                <Link href={`/desk/orders/${quote.order.id}`}>
                  {t("acceptedOrder")} →
                </Link>
              ) : (
                t("awaiting")
              )}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
