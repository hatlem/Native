import { getTranslations } from "next-intl/server";
import type { Invoice } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { StatusBadge } from "@/app/status-badge";
import { SectionHead } from "@/components";
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
            const asset = line.brief?.assets[0];
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
          }),
        )}
      </div>
    </section>
  );
}
