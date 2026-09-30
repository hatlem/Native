import { getTranslations } from "next-intl/server";
import type { Invoice } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { SectionHead } from "@/components";
import { resolveEffectiveAsset } from "@/lib/writers/placement";
import type { OrderWithDetails, ProductWithTitle } from "./types";

// Confirmed-order section — inventory lines with production status, a link
// to each order's own page (production, content review, campaign report —
// otherwise only reachable from a notification) and to the invoice once one
// exists. A multi-market request has one order per market, labelled by
// currency.
export async function OrderSection({
  locale,
  orders,
  orderLinks,
  byId,
  orderInvoice,
}: {
  locale: string;
  orders: OrderWithDetails[];
  orderLinks: { id: string; currency: string }[];
  byId: Map<string, ProductWithTitle>;
  orderInvoice: Invoice | undefined;
}) {
  const t = await getTranslations({ locale, namespace: "requests" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tp = await getTranslations({ locale, namespace: "production" });
  const ti = await getTranslations({ locale, namespace: "invoice" });

  // Version-locking-aware status: the locked version once the placement is
  // FINAL-locked, otherwise the article's latest — never just "the newest
  // version", which can belong to a sibling placement's draft on a shared
  // article. Resolve all lines before the JSX since the render below is a
  // synchronous .map(). Mirrors orders/[orderId]/page.tsx.
  const effectiveAssets = new Map<string, Awaited<ReturnType<typeof resolveEffectiveAsset>>>();
  for (const o of orders) {
    for (const line of o.lines) {
      if (!line.articlePlacement) continue;
      effectiveAssets.set(line.id, await resolveEffectiveAsset(line.articlePlacement));
    }
  }

  return (
    <section className="section">
      <SectionHead
        eyebrow={t("orderEyebrow")}
        title={
          <>
            {t("order")}{" "}
            <StatusBadge value={orders[0].status} />
          </>
        }
        trailing={
          <div className="cluster tight">
            {orderLinks.map((o) => (
              <Link key={o.id} href={`/orders/${o.id}`} className="btn small">
                {orderLinks.length > 1
                  ? t("openOrderMarket", { currency: o.currency })
                  : t("openOrder")}{" "}
                →
              </Link>
            ))}
            {orderInvoice ? (
              <Link
                href={`/invoices/${orderInvoice.id}`}
                className="btn small secondary"
              >
                {ti("title")} →
              </Link>
            ) : null}
          </div>
        }
      />
      <div className="grid">
        {orders.flatMap((o) =>
          o.lines
            .filter((line) => line.kind === "INVENTORY" && line.productId)
            .map((line) => {
            const p = line.productId ? byId.get(line.productId) : undefined;
            const asset = effectiveAssets.get(line.id) ?? null;
            return (
              <article className="card" key={line.id}>
                <h3>{p?.title.name ?? line.productId}</h3>
                <p className="muted">{p ? tType(p.type) : ""}</p>
                <div className="cluster tight">
                  {asset ? (
                    <>
                      <span className="muted small">
                        {tp("status")}:
                      </span>
                      <StatusBadge value={asset.status} />
                      {line.articlePlacement?.specPassed === true ? (
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
          }),
        )}
      </div>
    </section>
  );
}
