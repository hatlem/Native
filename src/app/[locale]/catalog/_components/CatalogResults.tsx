import { getTranslations } from "next-intl/server";
import { Prisma } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { intlLocale } from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing/visibility";
import { bandLabel } from "@/lib/pricing/bands";
import { titleBand, titleRate } from "@/lib/pricing/display-price";
import { loadPricingDefaults } from "@/lib/content-fee";
import { titleDisplayName } from "@/lib/title-display";
import { EmptyState } from "@/app/empty-state";
import { localizeCategory } from "@/lib/taxonomy-i18n";
import type { AppLocale } from "@/i18n/routing";
import { CompareSelectionProvider, TitleSelector } from "./CompareSelection";
import { FavoriteButton, type FavListOption } from "./FavoriteButton";

export type CatalogTitleRow = Prisma.TitleGetPayload<{
  include: {
    publisher: true;
    market: true;
    products: {
      where: { active: true };
      include: { priceRules: true };
    };
  };
}>;

export async function CatalogResults({
  locale,
  titles,
  compareMode,
  favoritedIds,
  favoriteLists,
  listMembership,
  noOrg = false,
}: {
  locale: string;
  titles: CatalogTitleRow[];
  compareMode: boolean;
  favoritedIds: Set<string>;
  favoriteLists: FavListOption[];
  listMembership: Record<string, string[]>;
  /** Agency session with no client selected — no org to scope lists to. */
  noOrg?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "catalog" });
  const tf = await getTranslations({ locale, namespace: "firm" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tFit = await getTranslations({ locale, namespace: "nativeFit" });
  const tv = await getTranslations({
    locale,
    namespace: "priceVisibility",
  });

  const pricing = await loadPricingDefaults();

  return titles.length === 0 ? (
    <EmptyState
      title={t("noResults")}
      primaryHref="/catalog"
      primaryLabel={t("clearFilters")}
    />
  ) : (
    <CompareSelectionProvider enabled={compareMode}>
    <div className="grid">
      {titles.map((title) => {
        // Per-product visibility: active + confirmedAt + pricesPublic flags.
        // The card shows a bucket BAND, never an exact figure — exact prices
        // exist only in the quote flow (see display-price.ts).
        const visibleProducts = title.products.filter((p) =>
          isProductPriceShown(p, title),
        );
        const anyHidden = title.products.some(
          (p) => !isProductPriceShown(p, title),
        );
        const fromBand = titleBand(title.products, title, pricing);
        // CPM/CPC-only titles (Adresseavisen) have no flat band but DO
        // have confirmed pricing — show the cheapest unit rate instead of
        // a misleading "Contact for price".
        const fromRate = fromBand
          ? null
          : titleRate(title.products, title, pricing);
        const needsQuote = title.products.length === 0;

        return (
          <article className="card catalog-card" key={title.id}>
            <TitleSelector id={title.id} />
            <FavoriteButton
              locale={locale}
              titleId={title.id}
              initialFavorited={favoritedIds.has(title.id)}
              lists={favoriteLists}
              inListIds={listMembership[title.id] ?? []}
              noOrg={noOrg}
            />
            <h3>
              <Link className="card-link" href={`/catalog/${title.slug}`}>
                {titleDisplayName(title)}
              </Link>
            </h3>
            <div className="muted">
              {/* Publisher drill-down ("everything from Amedia"). Sits above
                  the stretched card link via the a:not(.card-link) z-index
                  rule, so it's clickable inside the clickable card. */}
              <Link href={`/catalog?publisher=${title.publisher.id}`}>
                {title.publisher.name}
              </Link>{" "}
              · {tMarket(title.market.code)}
            </div>
            <div>
              <span className="tag">
                {localizeCategory(title.category, locale as AppLocale)}
              </span>
              {title.offersNativeContent ? (
                <span className="tag">{t("card.offersNative")}</span>
              ) : null}
              {/* One tag per distinct format — a title with five article
                  products should read "Native-artikkel" once, not five times. */}
              {[...new Set(title.products.map((p) => p.type))].map((type) => (
                <span className="tag" key={type}>
                  {tType(type)}
                </span>
              ))}
              {visibleProducts.some((p) => p.visibility === "FIRM") ? (
                <span className="tag">⚡ {tf("badge")}</span>
              ) : null}
              {needsQuote ? (
                <span className="tag">{t("card.requestQuote")}</span>
              ) : null}
              {anyHidden ? (
                <span className="tag">{tv("requestPrice")}</span>
              ) : null}
              {title.nativeFit ? (
                <span className="tag">
                  {t("card.nativeFit", { value: tFit(title.nativeFit as "High" | "Medium" | "Low") })}
                </span>
              ) : null}
              {title.b2bB2c ? (
                <span className="tag">{title.b2bB2c}</span>
              ) : null}
            </div>
            {title.description ? (
              <div className="muted" style={{ marginTop: 8 }}>
                {title.description.length > 140
                  ? `${title.description.slice(0, 140)}…`
                  : title.description}
              </div>
            ) : title.vertical ? (
              <div className="muted" style={{ marginTop: 8 }}>
                {title.vertical}
              </div>
            ) : null}
            {title.digitalReach ? (
              <div className="muted" style={{ marginTop: 10 }}>
                {t("card.digitalReach")}:{" "}
                {new Intl.NumberFormat(intlLocale(locale)).format(title.digitalReach)}
              </div>
            ) : title.monthlyReach ? (
              <div className="muted" style={{ marginTop: 10 }}>
                {t("card.reach")}:{" "}
                {new Intl.NumberFormat(intlLocale(locale)).format(title.monthlyReach)}
              </div>
            ) : null}
            {fromBand ? (
              <>
                <div className="price">
                  ≈ {bandLabel(fromBand.band, fromBand.product.currency)}{" "}
                  <span className="muted" title={tv("listIndicativeHelp")}>
                    · {tv("listIndicative")}
                  </span>
                </div>
                <div className="muted">✓ {tv("productionIncluded")}</div>
              </>
            ) : fromRate ? (
              <div className="price">
                ≈ {fromRate.rate} {fromRate.product.currency} {fromRate.unit}{" "}
                <span className="muted" title={tv("listIndicativeHelp")}>
                  · {tv("listIndicative")}
                </span>
              </div>
            ) : anyHidden ? (
              <div className="price muted">{tv("requestPrice")}</div>
            ) : null}
          </article>
        );
      })}
    </div>
    </CompareSelectionProvider>
  );
}
