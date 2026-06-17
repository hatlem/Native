import { getTranslations } from "next-intl/server";
import type { PlanItem } from "@prisma/client";
import { SectionHead } from "@/components";
import type { ProductWithTitle } from "./types";

// Plan items grid — what the buyer asked to have priced.
export async function PlanItemsSection({
  locale,
  items,
  byId,
  titleById,
}: {
  locale: string;
  items: PlanItem[];
  byId: Map<string, ProductWithTitle>;
  titleById: Map<string, { name: string }>;
}) {
  const t = await getTranslations({ locale, namespace: "requests" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  return (
    <section className="section">
      <SectionHead eyebrow={t("itemsEyebrow")} title={t("items")} />
      <div className="grid">
        {items.map((item) => {
          // Title placeholder — no product chosen yet; the desk proposes
          // the concrete placement.
          if (!item.productId) {
            const titleName = item.titleId
              ? titleById.get(item.titleId)?.name ?? "Publication"
              : "Publication";
            return (
              <article className="card" key={item.id}>
                <h3>{titleName}</h3>
                <p className="muted">Placement to be proposed by our desk</p>
                <span className="tag">× {item.quantity}</span>
              </article>
            );
          }
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
  );
}
