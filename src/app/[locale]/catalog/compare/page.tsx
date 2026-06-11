import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { intlLocale } from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing/visibility";
import { bandLabel } from "@/lib/pricing/bands";
import { titleBand } from "@/lib/pricing/display-price";
import { loadContentFeeRules } from "@/lib/content-fee";
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
  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/signin?next=/${locale}/catalog/compare`);
  }
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "compare" });
  const tc = await getTranslations({ locale, namespace: "catalog" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tType = await getTranslations({ locale, namespace: "productType" });
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
      discontinuedAt: null,
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

  const feeRules = await loadContentFeeRules();

  return (
    <section>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>
      <p>
        <Link href="/catalog">← {t("back")}</Link>
      </p>

      {/* Precompute per-title row values so the table body is just a
          map over a row spec. Avoids inline ternaries per cell. */}
      {(() => {
        const rows = ordered.map((title) => {
          const anyHidden = title.products.some(
            (p) => !isProductPriceShown(p, title),
          );
          const fromBand = titleBand(title.products, title, feeRules);
          const leadMin = title.products.length
            ? Math.min(...title.products.map((p) => p.leadTimeDays))
            : null;
          return { title, anyHidden, fromBand, leadMin };
        });

        return (
          <div className="table-wrap responsive">
            <table className="table compare-titles-table">
              <thead>
                <tr>
                  <th>{t("rowAttribute")}</th>
                  {rows.map(({ title }) => (
                    <th key={title.id}>
                      <Link href={`/catalog/${title.slug}`}>{title.name}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>{t("rowPublisher")}</strong>
                  </td>
                  {rows.map(({ title }) => (
                    <td key={title.id}>{title.publisher.name}</td>
                  ))}
                </tr>
                <tr>
                  <td>
                    <strong>{t("rowMarket")}</strong>
                  </td>
                  {rows.map(({ title }) => (
                    <td key={title.id}>{tMarket(title.market.code)}</td>
                  ))}
                </tr>
                <tr>
                  <td>
                    <strong>{t("rowCategory")}</strong>
                  </td>
                  {rows.map(({ title }) => (
                    <td key={title.id} className="muted">
                      {title.category}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>
                    <strong>{t("rowReach")}</strong>
                  </td>
                  {rows.map(({ title }) => (
                    <td key={title.id} className="num">
                      {title.monthlyReach
                        ? new Intl.NumberFormat(intlLocale(locale)).format(title.monthlyReach)
                        : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>
                    <strong>{t("rowLeadTime")}</strong>
                  </td>
                  {rows.map(({ title, leadMin }) => (
                    <td key={title.id} className="num">
                      {leadMin !== null
                        ? `${leadMin} ${tc("card.days")}`
                        : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>
                    <strong>{t("rowFormats")}</strong>
                  </td>
                  {rows.map(({ title }) => (
                    <td key={title.id}>
                      {title.products.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <span className="cluster tight">
                          {title.products.map((p) => (
                            <span className="tag" key={p.id}>
                              {tType(p.type)}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>
                    <strong>{t("rowFromPrice")}</strong>
                  </td>
                  {rows.map(({ title, fromBand, anyHidden }) => (
                    <td key={title.id} className="num">
                      {fromBand ? (
                        <span className="price">
                          ≈ {bandLabel(fromBand.band, fromBand.product.currency)}
                        </span>
                      ) : anyHidden ? (
                        <span className="muted">{tv("requestPrice")}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>
                    <strong>{t("rowAction")}</strong>
                  </td>
                  {rows.map(({ title }) => (
                    <td key={title.id}>
                      <Link
                        href={`/catalog/${title.slug}`}
                        className="link"
                      >
                        {t("view")} →
                      </Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        );
      })()}

      <p className="note">{tc("indicativeNote")}</p>
    </section>
  );
}
