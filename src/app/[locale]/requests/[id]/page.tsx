import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWorkspace } from "@/lib/workspace";
import { DataLayerEvent } from "@/app/data-layer-event";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { acceptQuote } from "@/app/actions";

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

  // Org-scoped: the desk sees any request; an advertiser sees only its
  // own, an agency any of its clients'. Anyone else gets a 404 (don't
  // leak existence).
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

  return (
    <section>
      <h1>
        {t("title")} · {request.organization.name}
      </h1>
      <p className="muted">
        {t("status")}: {request.status}
      </p>
      <DataLayerEvent event="rfq_submitted" id={request.id} />
      {quote?.order ? (
        <DataLayerEvent
          event="order_confirmed"
          id={quote.order.id}
          value={Number(quote.total)}
          currency={quote.currency}
        />
      ) : null}

      <h2 style={{ marginTop: 24 }}>{t("items")}</h2>
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
        <p className="note">{t("pending")}</p>
      ) : (
        <>
          <h2 style={{ marginTop: 24 }}>{t("quote")}</h2>
          <div className="card">
            {quote.lines.map((l) => (
              <div key={l.id} className="muted">
                {l.description} × {l.quantity} —{" "}
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
            {quote.validUntil ? (
              <div className="muted" style={{ marginTop: 8 }}>
                {t("validUntil")}:{" "}
                {quote.validUntil.toISOString().slice(0, 10)}
              </div>
            ) : null}

            {quote.order ? (
              <p className="note">
                {t("accepted")} — {t("orderStatus")}: {quote.order.status}
              </p>
            ) : (
              <form action={acceptQuote} style={{ marginTop: 12 }}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="quoteId" value={quote.id} />
                <button type="submit" className="btn" style={{ marginTop: 0 }}>
                  {t("accept")}
                </button>
              </form>
            )}
          </div>
        </>
      )}

      {(() => {
        const order = quote?.order;
        if (!order) return null;
        const orderInvoice = order.invoices[0];
        return (
          <>
            <h2 style={{ marginTop: 24 }}>
              {t("order")} · {order.status}
            </h2>
            <div className="grid">
              {order.lines.map((line) => {
                const p = byId.get(line.productId);
                const asset = line.brief?.assets[0];
                return (
                  <article className="card" key={line.id}>
                    <h3>{p?.title.name ?? line.productId}</h3>
                    <div className="muted">{p ? tType(p.type) : ""}</div>
                    <div className="muted">
                      {tp("status")}:{" "}
                      {asset ? asset.status : tp("noAssets")}
                      {asset?.specPassed === true ? ` · ✅` : null}
                    </div>
                  </article>
                );
              })}
            </div>
            {orderInvoice ? (
              <p className="note">
                <Link href={`/invoices/${orderInvoice.id}`}>
                  {ti("title")} →
                </Link>
              </p>
            ) : null}
          </>
        );
      })()}

      <p className="note" style={{ marginTop: 24 }}>
        <Link href="/catalog">← {tNav("catalog")}</Link>
      </p>
    </section>
  );
}
