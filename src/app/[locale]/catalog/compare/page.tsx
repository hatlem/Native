import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { indicativeFromRules, toRateRules, formatMoney } from "@/lib/money";
import { EmptyState } from "@/app/empty-state";

export const dynamic = "force-dynamic";

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
    .slice(0, 6);

  if (ids.length === 0) {
    return (
      <>
        <header className="page-header">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("subtitle")}</p>
        </header>
        <EmptyState
          title={t("empty")}
          primaryHref="/catalog"
          primaryLabel={tc("title")}
        />
      </>
    );
  }

  const titles = await prisma.title.findMany({
    where: { id: { in: ids }, active: true },
    include: {
      publisher: true,
      market: true,
      products: {
        where: { active: true },
        include: { priceRules: true, spec: true },
      },
    },
  });

  const ordered = ids
    .map((id) => titles.find((t) => t.id === id))
    .filter((t): t is (typeof titles)[number] => !!t);

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/catalog" className="small-link">
          ← {tc("title")}
        </Link>
      </nav>

      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("subtitle")}</p>
      </header>

      <div className="compare-grid">
        <div className="compare-header">
          <span className="compare-label">{t("rowAttribute")}</span>
          {ordered.map((title) => (
            <div key={title.id} className="compare-title">
              <Link href={`/catalog/${title.slug}`}>{title.name}</Link>
              <div className="muted small">{title.publisher.name}</div>
            </div>
          ))}
        </div>

        <CompareRow label={t("rowMarket")}>
          {ordered.map((title) => (
            <span key={title.id} className="tag">
              {tMarket(title.market.code)}
            </span>
          ))}
        </CompareRow>

        <CompareRow label={t("rowCategory")}>
          {ordered.map((title) => (
            <span key={title.id}>{title.category ?? "—"}</span>
          ))}
        </CompareRow>

        <CompareRow label={tc("card.reach")}>
          {ordered.map((title) => (
            <span key={title.id} className="num">
              {title.monthlyReach
                ? new Intl.NumberFormat(locale).format(title.monthlyReach)
                : "—"}
            </span>
          ))}
        </CompareRow>

        <CompareRow label={tc("card.leadTime")}>
          {ordered.map((title) => {
            const leadMin = title.products.length
              ? Math.min(...title.products.map((p) => p.leadTimeDays))
              : null;
            return (
              <span key={title.id}>
                {leadMin !== null
                  ? `${leadMin} ${tc("card.days")}`
                  : "—"}
              </span>
            );
          })}
        </CompareRow>

        <CompareRow label={t("rowFormats")}>
          {ordered.map((title) => (
            <div key={title.id} className="tag-row">
              {title.products.map((p) => (
                <span className="tag" key={p.id}>
                  {tType(p.type)}
                </span>
              ))}
            </div>
          ))}
        </CompareRow>

        <CompareRow label={tc("card.from")}>
          {ordered.map((title) => {
            const prices = title.products.map((p) =>
              indicativeFromRules(
                Number(p.basePrice),
                toRateRules(p.priceRules),
              ),
            );
            const from = prices.length ? Math.min(...prices) : null;
            const cur = title.products[0]?.currency ?? title.market.currency;
            return (
              <span key={title.id} className="price">
                {from !== null ? formatMoney(from, cur, locale) : "—"}
              </span>
            );
          })}
        </CompareRow>

        <CompareRow label="">
          {ordered.map((title) => (
            <Link
              key={title.id}
              href={`/catalog/${title.slug}`}
              className="btn small block"
            >
              {t("view")}
            </Link>
          ))}
        </CompareRow>
      </div>

      <p className="note">{tc("indicativeNote")}</p>
    </>
  );
}

function CompareRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="compare-row">
      <div className="compare-label">{label}</div>
      {children}
    </div>
  );
}
