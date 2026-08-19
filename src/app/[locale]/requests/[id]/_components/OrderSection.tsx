import { getTranslations } from "next-intl/server";
import type { Invoice } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { SectionHead } from "@/components";
import { resolveEffectiveAsset } from "@/lib/writers/placement";
import type { OrderWithDetails, ProductWithTitle } from "./types";

// Confirmed-order section — inventory lines with production status,
// plus a link to the invoice once one exists.
export async function OrderSection({
  locale,
  orders,
  byId,
  orderInvoice,
}: {
  locale: string;
  orders: OrderWithDetails[];
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
          orderInvoice ? (
            <Link
              href={`/invoices/${orderInvoice.id}`}
              className="btn small secondary"
            >
              {ti("title")} →
            </Link>
          ) : null
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
