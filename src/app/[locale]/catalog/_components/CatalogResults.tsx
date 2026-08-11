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
import type { ProductInclusions } from "@/lib/pricing/inclusions";
import type { AppLocale } from "@/i18n/routing";
import { CompareSelectionProvider, TitleSelector } from "./CompareSelection";
import { FavoriteButton, type FavListOption } from "./FavoriteButton";
import { ShortlistButton } from "./Shortlist";

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

export type Density = "list" | "cards";

export async function CatalogResults({
  locale,
  titles,
  density,
  compareMode,
  favoritedIds,
  favoriteLists,
  listMembership,
  noOrg = false,
}: {
  locale: string;
  titles: CatalogTitleRow[];
  density: Density;
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
  const tv = await getTranslations({ locale, namespace: "priceVisibility" });
  const tr = await getTranslations({ locale, namespace: "catalog.row" });

  const pricing = await loadPricingDefaults();

  if (titles.length === 0) {
    return (
      <EmptyState
        title={t("noResults")}
        primaryHref="/catalog"
        primaryLabel={t("clearFilters")}
      />
    );
  }

  const rows = titles.map((title) => {
    // Per-product visibility: active + confirmedAt + pricesPublic flags.
    // The list/card shows a bucket BAND or unit rate, never an exact
    // figure — exact prices exist only in the quote flow (display-price.ts).
    const visibleProducts = title.products.filter((p) => isProductPriceShown(p, title));
    const anyHidden = title.products.some((p) => !isProductPriceShown(p, title));
    const fromBand = titleBand(title.products, title, pricing);
    // CPM/CPC-only titles (Adresseavisen) have no flat band but DO have
    // confirmed pricing — show the cheapest unit rate instead of a
    // misleading "Contact for price".
    const fromRate = fromBand ? null : titleRate(title.products, title, pricing);
    const needsQuote = title.products.length === 0;
    const hasPrice = Boolean(fromBand || fromRate);
    const instantBook = visibleProducts.some((p) => p.visibility === "FIRM");
    // What "Add to plan" actually adds: the priced product the band/rate
    // figure came from, else any visible-priced product, else — for a
    // hidden-price title the desk still needs to quote — the first active
    // product at all. Null only when the title has no products yet.
    const addableProduct =
      fromBand?.product ?? fromRate?.product ?? visibleProducts[0] ?? title.products[0] ?? null;
    const inclusions = addableProduct?.inclusions as ProductInclusions | null | undefined;
    const articleState: "written" | "supplied" | "unknown" =
      inclusions?.production === "PUBLISHER"
        ? "written"
        : inclusions?.production === "ADVERTISER"
          ? "supplied"
          : "unknown";
    const reach = title.digitalReach ?? title.monthlyReach ?? null;

    return {
      title,
      visibleProducts,
      anyHidden,
      fromBand,
      fromRate,
      needsQuote,
      hasPrice,
      instantBook,
      addableProduct,
      articleState,
      reach,
    };
  });

  return (
    <CompareSelectionProvider enabled={compareMode}>
      {density === "list" ? (
        <div className="catalog-list">
          {rows.map((r) => (
            <CatalogListRow
              key={r.title.id}
              row={r}
              locale={locale}
              t={t}
              tf={tf}
              tv={tv}
              tMarket={tMarket}
              tr={tr}
              favoritedIds={favoritedIds}
              favoriteLists={favoriteLists}
              listMembership={listMembership}
              noOrg={noOrg}
            />
          ))}
        </div>
      ) : (
        <div className="grid catalog-grid">
          {rows.map((r) => (
            <CatalogCard
              key={r.title.id}
              row={r}
              locale={locale}
              t={t}
              tf={tf}
              tv={tv}
              tType={tType}
              tMarket={tMarket}
              tFit={tFit}
              favoritedIds={favoritedIds}
              favoriteLists={favoriteLists}
              listMembership={listMembership}
              noOrg={noOrg}
            />
          ))}
        </div>
      )}
    </CompareSelectionProvider>
  );
}

// The per-title shape computed once in CatalogResults and consumed by both
// the list-row and card render branches below.
type Row = {
  title: CatalogTitleRow;
  visibleProducts: CatalogTitleRow["products"];
  anyHidden: boolean;
  fromBand: ReturnType<typeof titleBand>;
  fromRate: ReturnType<typeof titleRate>;
  needsQuote: boolean;
  hasPrice: boolean;
  instantBook: boolean;
  addableProduct: CatalogTitleRow["products"][number] | null;
  articleState: "written" | "supplied" | "unknown";
  reach: number | null;
};

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function CatalogListRow({
  row,
  locale,
  t,
  tf,
  tv,
  tMarket,
  tr,
  favoritedIds,
  favoriteLists,
  listMembership,
  noOrg,
}: {
  row: Row;
  locale: string;
  t: Translator;
  tf: Translator;
  tv: Translator;
  tMarket: Translator;
  tr: Translator;
  favoritedIds: Set<string>;
  favoriteLists: FavListOption[];
  listMembership: Record<string, string[]>;
  noOrg: boolean;
}) {
  const { title, fromBand, fromRate, hasPrice, instantBook, addableProduct, articleState, reach } = row;
  const description = title.description
    ? title.description.length > 160
      ? `${title.description.slice(0, 160)}…`
      : title.description
    : title.vertical;

  return (
    <div className="catalog-row">
      <div className="catalog-row__main">
        <div className="catalog-row__title-line">
          <Link className="catalog-row__title" href={`/catalog/${title.slug}`}>
            {titleDisplayName(title)}
          </Link>
          {instantBook ? (
            <span className="badge badge-success dotless catalog-row__instant">
              ⚡ {tf("badge")}
            </span>
          ) : null}
        </div>
        <div className="catalog-row__meta">
          {/* Plain <a>, not <Link>: same-route RSC soft navigation is
              currently broken in production on this page (see
              CatalogSort.tsx) — a <Link> here would be silently inert. */}
          <a href={`/${locale}/catalog?publisher=${title.publisher.id}`}>{title.publisher.name}</a>
          {" · "}
          {tMarket(title.market.code)}
          {reach ? (
            <>
              {" · "}
              {tr("readers", { count: new Intl.NumberFormat(intlLocale(locale)).format(reach) })}
            </>
          ) : null}
        </div>
        {description ? <p className="catalog-row__desc">{description}</p> : null}
        <div className="catalog-row__tags">
          <span className="tag">{localizeCategory(title.category, locale as AppLocale)}</span>
          {title.offersNativeContent ? <span className="tag">{t("card.offersNative")}</span> : null}
          {title.b2bB2c ? <span className="tag">{title.b2bB2c}</span> : null}
        </div>
      </div>

      <div className="catalog-row__price">
        {fromBand ? (
          <>
            <div className="catalog-row__amount">
              ≈ {bandLabel(fromBand.band, fromBand.product.currency)}
            </div>
            <div className="catalog-row__price-note">{tv("listIndicative")}</div>
          </>
        ) : fromRate ? (
          <>
            <div className="catalog-row__amount">
              ≈ {fromRate.rate} {fromRate.product.currency} {fromRate.unit}
            </div>
            <div className="catalog-row__price-note">{tv("listIndicative")}</div>
          </>
        ) : (
          <>
            <div className="catalog-row__amount catalog-row__amount--muted">{tr("priceOnRequest")}</div>
            <div className="catalog-row__price-note">{tr("deskConfirms")}</div>
          </>
        )}
        <span
          className={`badge dotless catalog-row__article-pill${
            articleState === "written"
              ? " badge-success"
              : articleState === "supplied"
                ? " badge-warning"
                : " badge-neutral"
          }`}
        >
          {articleState === "written"
            ? tr("articleWritten")
            : articleState === "supplied"
              ? tr("articleSupplied")
              : tr("articleUnknown")}
        </span>
      </div>

      <div className="catalog-row__actions">
        <FavoriteButton
          locale={locale}
          titleId={title.id}
          initialFavorited={favoritedIds.has(title.id)}
          lists={favoriteLists}
          inListIds={listMembership[title.id] ?? []}
          noOrg={noOrg}
        />
        <Link href={`/catalog/${title.slug}`} className="btn small secondary catalog-row__preview">
          {tr("preview")}
        </Link>
        {addableProduct ? (
          <ShortlistButton
            productId={addableProduct.id}
            titleName={titleDisplayName(title)}
            amount={
              fromBand
                ? Number(fromBand.product.basePrice)
                : fromRate
                  ? Number(fromRate.product.basePrice)
                  : null
            }
            currency={addableProduct.currency}
            withContent={false}
            hasPrice={hasPrice}
            addLabel={tr("addToPlan")}
            addedLabel={tr("onPlan")}
            askLabel={tr("askForPrice")}
          />
        ) : (
          <Link href={`/catalog/${title.slug}`} className="btn small catalog-row__cta">
            {tr("askForPrice")}
          </Link>
        )}
      </div>
    </div>
  );
}

function CatalogCard({
  row,
  locale,
  t,
  tf,
  tv,
  tType,
  tMarket,
  tFit,
  favoritedIds,
  favoriteLists,
  listMembership,
  noOrg,
}: {
  row: Row;
  locale: string;
  t: Translator;
  tf: Translator;
  tv: Translator;
  tType: Translator;
  tMarket: Translator;
  tFit: Translator;
  favoritedIds: Set<string>;
  favoriteLists: FavListOption[];
  listMembership: Record<string, string[]>;
  noOrg: boolean;
}) {
  const { title, visibleProducts, anyHidden, fromBand, fromRate, needsQuote, reach } = row;
  return (
    <article className="card catalog-card">
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
        {/* Plain <a>, not <Link>: same-route RSC soft navigation is
            currently broken in production on this page (see
            CatalogSort.tsx) — a <Link> here would be silently inert. */}
        <a href={`/${locale}/catalog?publisher=${title.publisher.id}`}>{title.publisher.name}</a>{" "}
        · {tMarket(title.market.code)}
      </div>
      <div>
        <span className="tag">{localizeCategory(title.category, locale as AppLocale)}</span>
        {title.offersNativeContent ? <span className="tag">{t("card.offersNative")}</span> : null}
        {[...new Set(title.products.map((p) => p.type))].map((type) => (
          <span className="tag" key={type}>
            {tType(type)}
          </span>
        ))}
        {visibleProducts.some((p) => p.visibility === "FIRM") ? (
          <span className="tag">⚡ {tf("badge")}</span>
        ) : null}
        {needsQuote ? <span className="tag">{t("card.requestQuote")}</span> : null}
        {anyHidden ? <span className="tag">{tv("requestPrice")}</span> : null}
        {title.nativeFit ? (
          <span className="tag">
            {t("card.nativeFit", { value: tFit(title.nativeFit as "High" | "Medium" | "Low") })}
          </span>
        ) : null}
        {title.b2bB2c ? <span className="tag">{title.b2bB2c}</span> : null}
      </div>
      {title.description ? (
        <div className="muted" style={{ marginTop: 8 }}>
          {title.description.length > 140 ? `${title.description.slice(0, 140)}…` : title.description}
        </div>
      ) : title.vertical ? (
        <div className="muted" style={{ marginTop: 8 }}>
          {title.vertical}
        </div>
      ) : null}
      {reach ? (
        <div className="muted" style={{ marginTop: 10 }}>
          {title.digitalReach ? t("card.digitalReach") : t("card.reach")}:{" "}
          {new Intl.NumberFormat(intlLocale(locale)).format(reach)}
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
      ) : null}
    </article>
  );
}
