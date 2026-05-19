import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { indicativePrice, formatMoney } from "@/lib/money";
import { addToPlan } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function TitleDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "titleDetail" });
  const tf = await getTranslations({ locale, namespace: "firm" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  const title = await prisma.title.findUnique({
    where: { slug },
    include: {
      publisher: true,
      market: true,
      products: {
        where: { active: true },
        include: { priceRules: true, spec: true },
      },
    },
  });

  if (!title || !title.active) notFound();

  return (
    <section>
      <p>
        <Link href="/catalog">← {t("back")}</Link>
      </p>
      <h1>{title.name}</h1>
      <p className="muted">
        {t("publishedBy")} {title.publisher.name} · {tMarket(title.market.code)}{" "}
        · {title.category}
      </p>
      {title.monthlyReach ? (
        <p className="muted">
          {t("reach")}: {new Intl.NumberFormat().format(title.monthlyReach)}
        </p>
      ) : null}

      <div className="grid">
        {title.products.map((p) => {
          const rule = p.priceRules[0];
          const price = indicativePrice(
            Number(p.basePrice),
            rule ? Number(rule.marginPct) : 15,
            rule ? Number(rule.seasonalMultiplier) : 1,
          );
          return (
            <article className="card" key={p.id}>
              <h3>{tType(p.type)}</h3>
              <div className="price">
                {t("from")} {formatMoney(price, p.currency, locale)}
              </div>
              {p.visibility === "FIRM" ? (
                <span className="tag">⚡ {tf("badge")}</span>
              ) : null}
              <div className="muted" style={{ marginTop: 6 }}>
                {t("leadTime")}: {p.leadTimeDays} {t("days")}
              </div>
              {p.spec ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  <strong>{t("spec")}</strong>
                  <br />
                  {p.spec.wordCountMin && p.spec.wordCountMax ? (
                    <>
                      {t("words")}: {p.spec.wordCountMin}–{p.spec.wordCountMax}
                      <br />
                    </>
                  ) : null}
                  {t("images")}: {p.spec.imagesMin ?? 0}
                  <br />
                  {p.spec.disclosureLabel ? (
                    <>
                      {t("disclosure")}: {p.spec.disclosureLabel}
                    </>
                  ) : null}
                </div>
              ) : null}
              <form action={addToPlan} style={{ marginTop: 12 }}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="productId" value={p.id} />
                <button type="submit" className="btn" style={{ marginTop: 0 }}>
                  {t("addToPlan")}
                </button>
              </form>
            </article>
          );
        })}
      </div>

      <p className="note">{t("indicativeNote")}</p>
    </section>
  );
}
