import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { intlLocale } from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing/visibility";
import { bandLabel } from "@/lib/pricing/bands";
import { bandIncludesArticle, titleBand } from "@/lib/pricing/display-price";
import { loadPricingDefaults } from "@/lib/content-fee";
import { EmptyState } from "@/app/empty-state";
import { catalogVisibleTitleWhere } from "@/lib/catalog-visibility";
import { localizeCategory } from "@/lib/taxonomy-i18n";
import type { AppLocale } from "@/i18n/routing";
import { titleDisplayName } from "@/lib/title-display";
import { titleLeadTime } from "@/lib/lead-time";

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
  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/signin?next=/${locale}/catalog/compare`);
  }
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "compare" });
  const tc = await getTranslations({ locale, namespace: "catalog" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tDetail = await getTranslations({ locale, namespace: "titleDetail" });
  const tv = await getTranslations({
    locale,
    namespace: "priceVisibility",
  });

  const idsRaw = typeof sp.ids === "string" ? sp.ids : "";
  const ids = idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6); // cap so we don't blow up the layout

  const titles = ids.length
    ? await prisma.title.findMany({
        where: { AND: [{ id: { in: ids } }, catalogVisibleTitleWhere] },
        include: {
          publisher: true,
          market: true,
          products: { where: { active: true }, include: { priceRules: true, spec: true } },
        },
      })
    : [];

  const ordered = ids
    .map((id) => titles.find((t) => t.id === id))
    .filter((t): t is (typeof titles)[number] => !!t);

  // Nothing to compare: no ids, or only ids that match no visible title (a
  // stale link, a title since discontinued). Same empty state either way,
  // never an empty table.
  if (ordered.length === 0) {
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

  const pricing = await loadPricingDefaults();

  return (
    <section>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>
      <p>
        <Link href="/catalog">← {t("back")}</Link>
      </p>

      {(() => {
        const numberFmt = new Intl.NumberFormat(intlLocale(locale));
        const rows = ordered.map((title) => {
          const fromBand = titleBand(title.products, title, pricing);
          return {
          title,
          name: titleDisplayName(title),
          anyHidden: title.products.some((p) => !isProductPriceShown(p, title)),
          fromBand,
          bandWithArticle: fromBand ? bandIncludesArticle(fromBand.product, title, pricing) : false,
          // Same reach figure as the catalog card (digital first) and the
          // same lead time as the detail page (stated, else estimated) — a
          // title must not read "122 000" on one surface and "—" here.
          reach: title.digitalReach ?? title.monthlyReach ?? null,
          lead: titleLeadTime(title.products),
          };
        });
        type CompareRow = (typeof rows)[number];

        // One spec per attribute; the table body is a map over it. Every
        // value cell carries its title's name as data-label: below 640px
        // `.table-wrap.responsive` stacks each attribute into a card, and
        // without the label a card read "Norway / United Kingdom / Norway"
        // with no way to tell which title each value belonged to.
        const attributes: { key: string; label: string; className?: string; cell: (r: CompareRow) => ReactNode }[] = [
          { key: "publisher", label: t("rowPublisher"), cell: (r) => r.title.publisher.name },
          { key: "market", label: t("rowMarket"), cell: (r) => tMarket(r.title.market.code) },
          {
            key: "category",
            label: t("rowCategory"),
            className: "muted",
            cell: (r) => localizeCategory(r.title.category, locale as AppLocale),
          },
          {
            key: "reach",
            label: t("rowReach"),
            className: "num",
            cell: (r) => (r.reach ? numberFmt.format(r.reach) : "—"),
          },
          {
            key: "lead",
            label: t("rowLeadTime"),
            className: "num",
            cell: (r) =>
              r.lead.estimated
                ? tDetail("leadTimeEstimated", { days: r.lead.days })
                : `${r.lead.days} ${tc("card.days")}`,
          },
          {
            key: "formats",
            label: t("rowFormats"),
            cell: (r) =>
              r.title.products.length === 0 ? (
                <span className="muted">—</span>
              ) : (
                <span className="cluster tight">
                  {[...new Set(r.title.products.map((p) => p.type))].map((type) => (
                    <span className="tag" key={type}>
                      {tType(type)}
                    </span>
                  ))}
                </span>
              ),
          },
          {
            key: "price",
            label: t("rowFromPrice"),
            className: "num",
            cell: (r) =>
              r.fromBand ? (
                <span className="price">
                  ≈ {bandLabel(r.fromBand.band, r.fromBand.product.currency)}
                  {r.bandWithArticle ? (
                    <>
                      {" "}
                      <span className="muted small">{tv("productionIncluded")}</span>
                    </>
                  ) : null}
                </span>
              ) : r.anyHidden ? (
                <span className="muted">{tv("requestPrice")}</span>
              ) : (
                <span className="muted">—</span>
              ),
          },
          {
            key: "action",
            label: t("rowAction"),
            cell: (r) => (
              <Link href={`/catalog/${r.title.slug}`} className="link">
                {t("view")} →
              </Link>
            ),
          },
        ];

        return (
          <div className="table-wrap responsive">
            <table className="table compare-titles-table">
              <thead>
                <tr>
                  <th>{t("rowAttribute")}</th>
                  {rows.map((r) => (
                    <th key={r.title.id}>
                      <Link href={`/catalog/${r.title.slug}`}>{r.name}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attributes.map((a) => (
                  <tr key={a.key}>
                    <td>
                      <strong>{a.label}</strong>
                    </td>
                    {rows.map((r) => (
                      <td key={r.title.id} className={a.className} data-label={r.name}>
                        {a.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      <p className="note">{tc("indicativeNote")}</p>
    </section>
  );
}
