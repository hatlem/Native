import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { indicativeFromRules, toRateRules, formatMoney } from "@/lib/money";
import { EmptyState } from "@/app/empty-state";

export const dynamic = "force-dynamic";

// Phase-1 compare view (PLAN §6/§7). Buyers tick title ids in the URL
// (?ids=a,b,c) — the catalog page links here with the current selection.
// Server-rendered, no client state: works for SEO and is also linkable.
export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "compare" });
  const tc = await getTranslations({ locale, namespace: "catalog" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tType = await getTranslations({ locale, namespace: "productType" });

  const idsRaw = typeof sp.ids === "string" ? sp.ids : "";
  const ids = idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6); // cap so we don't blow up the layout

  if (ids.length === 0) {
    return (
      <section>
        <h1>{t("title")}</h1>
        <p className="muted">{t("subtitle")}</p>
        <EmptyState
          title={t("empty")}
          primaryHref="/catalog"
          primaryLabel={tc("title")}
        />
      </section>
    );
  }

  const titles = await prisma.title.findMany({
    where: {
      id: { in: ids },
      OR: [{ active: true }, { lastVerifiedAt: null }],
    },
    include: {
      publisher: true,
      market: true,
      products: { where: { active: true }, include: { priceRules: true, spec: true } },
    },
  });

  const ordered = ids
    .map((id) => titles.find((t) => t.id === id))
    .filter((t): t is (typeof titles)[number] => !!t);

  return (
    <section>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>
      <p>
        <Link href="/catalog">← {tc("title")}</Link>
      </p>

      <div className="grid">
        {ordered.map((title) => {
          const prices = title.products.map((p) =>
            indicativeFromRules(Number(p.basePrice), toRateRules(p.priceRules)),
          );
          const from = prices.length ? Math.min(...prices) : null;
          const cur = title.products[0]?.currency ?? title.market.currency;
          const leadMin = title.products.length
            ? Math.min(...title.products.map((p) => p.leadTimeDays))
            : null;
          return (
            <article className="card" key={title.id}>
              <h3>
                <Link href={`/catalog/${title.slug}`}>{title.name}</Link>
              </h3>
              <div className="muted">
                {title.publisher.name} · {tMarket(title.market.code)}
              </div>
              <div className="muted">{title.category}</div>
              {title.monthlyReach ? (
                <div className="muted">
                  {tc("card.reach")}: {new Intl.NumberFormat().format(title.monthlyReach)}
                </div>
              ) : null}
              {leadMin !== null ? (
                <div className="muted">
                  {tc("card.leadTime")}: {leadMin} {tc("card.days")}
                </div>
              ) : null}
              <div>
                {title.products.map((p) => (
                  <span className="tag" key={p.id}>
                    {tType(p.type)}
                  </span>
                ))}
              </div>
              {from !== null ? (
                <div className="price">
                  {tc("card.from")} {formatMoney(from, cur, locale)}
                </div>
              ) : null}
              <p className="note" style={{ marginTop: 8 }}>
                <Link href={`/catalog/${title.slug}`}>{t("view")} →</Link>
              </p>
            </article>
          );
        })}
      </div>

      <p className="note">{tc("indicativeNote")}</p>
    </section>
  );
}
