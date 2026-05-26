import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { indicativeFromRules, toRateRules, formatMoney } from "@/lib/money";
import { isProductPriceShown, arePricesVisible } from "@/lib/pricing-visibility";
import { addToPlan } from "@/app/actions";
import { SubmitButton } from "@/components";

export const dynamic = "force-dynamic";

export default async function TitleDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/signin?next=/${locale}/catalog/${slug}`);
  }
  // CSP nonce from middleware — required for the inline ld+json <script> below.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const t = await getTranslations({ locale, namespace: "titleDetail" });
  const tf = await getTranslations({ locale, namespace: "firm" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tFormats = await getTranslations({ locale, namespace: "formats" });
  const tv = await getTranslations({
    locale,
    namespace: "priceVisibility",
  });

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

  if (!title) notFound();
  // Verified-no-native titles stay hidden; everything else (commerce-active
  // and unverified research-catalog rows) renders.
  if (!title.active && title.lastVerifiedAt) notFound();

  // Title-level visibility gate (pricesPublic flags only) — used for
  // schema.org AggregateOffer wrapper and the bottom note.
  const titlePriceVisible = arePricesVisible(title);
  const siteBase =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "";
  // schema.org Offer/price is only emitted per-product when active +
  // confirmedAt + pricesPublic are all satisfied.
  const ldOffers = title.products.map((p) => {
    const shown = isProductPriceShown(p, title);
    return shown
      ? {
          "@type": "Offer",
          name: p.name,
          priceCurrency: p.currency,
          price: indicativeFromRules(
            Number(p.basePrice),
            toRateRules(p.priceRules),
          ),
          availability: p.bookable
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        }
      : {
          "@type": "Offer",
          name: p.name,
          priceCurrency: p.currency,
          availability: p.bookable
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        };
  });
  const anyPriceVisible = title.products.some((p) =>
    isProductPriceShown(p, title),
  );
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: title.name,
    category: title.category,
    brand: { "@type": "Brand", name: title.publisher.name },
    url: `${siteBase}/${locale}/catalog/${title.slug}`,
    offers: anyPriceVisible
      ? {
          "@type": "AggregateOffer",
          priceCurrency: title.market.currency,
          offers: ldOffers,
        }
      : { "@type": "AggregateOffer", offers: ldOffers },
  };
  const needsQuote = title.products.length === 0;

  return (
    <section>
      <script
        type="application/ld+json"
        nonce={nonce}
        // schema.org JSON-LD: PLAN §14 "structured data for discovery".
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
      <p>
        <Link href="/catalog">← {t("back")}</Link>
      </p>
      <h1>{title.name}</h1>
      <p className="muted">
        {t("publishedBy")} {title.publisher.name} · {tMarket(title.market.code)}{" "}
        · {title.category}
      </p>
      {title.digitalReach ? (
        <p className="muted">
          {t("digitalReach")}:{" "}
          {new Intl.NumberFormat().format(title.digitalReach)}
        </p>
      ) : title.monthlyReach ? (
        <p className="muted">
          {t("reach")}: {new Intl.NumberFormat().format(title.monthlyReach)}
        </p>
      ) : null}
      {/* Surface the rest of the CSV-imported research metadata so buyers
          can size up a research-catalog title even before requesting a quote. */}
      {title.type ||
      title.frequency ||
      title.b2bB2c ||
      title.format ||
      title.nativeFit ||
      title.reach ? (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {title.type ? <span className="tag">{title.type}</span> : null}
          {title.frequency ? (
            <span className="tag">{title.frequency}</span>
          ) : null}
          {title.b2bB2c ? <span className="tag">{title.b2bB2c}</span> : null}
          {title.format ? <span className="tag">{title.format}</span> : null}
          {title.nativeFit ? (
            <span className="tag">
              {t("nativeFitTag", { value: title.nativeFit })}
            </span>
          ) : null}
          {title.reach ? <span className="tag">{title.reach}</span> : null}
        </div>
      ) : null}
      {title.vertical ? (
        <p className="muted" style={{ marginTop: 8 }}>
          {title.vertical}
        </p>
      ) : null}
      {title.audience ? (
        <p className="muted">{title.audience}</p>
      ) : null}

      {needsQuote ? (
        <article className="card" style={{ marginTop: 16 }}>
          <h3>{t("requestQuote.title")}</h3>
          <p className="muted">{t("requestQuote.body")}</p>
          <Link href="/plan" className="btn" style={{ marginTop: 8 }}>
            {t("requestQuote.cta")}
          </Link>
        </article>
      ) : (
        <div className="grid">
        {title.products.map((p) => {
          const priceShown = isProductPriceShown(p, title);
          const price = indicativeFromRules(
            Number(p.basePrice),
            toRateRules(p.priceRules),
          );
          const formatSlug = p.type.toLowerCase().replace(/_/g, "-");
          return (
            <article className="card" key={p.id}>
              <h3>{tType(p.type)}</h3>
              <Link
                href={`/formats#${formatSlug}`}
                className="format-learn"
              >
                {tFormats("learnMore")} →
              </Link>
              {priceShown ? (
                <div className="price">
                  {t("from")} {formatMoney(price, p.currency, locale)}
                </div>
              ) : (
                <div className="price muted">{tv("requestPrice")}</div>
              )}
              {priceShown && p.visibility === "FIRM" ? (
                <span className="tag">⚡ {tf("badge")}</span>
              ) : null}
              <div className="muted" style={{ marginTop: 6 }}>
                {t("leadTime")}: {p.leadTimeDays} {t("days")}
              </div>
              {p.spec ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  <strong>{t("spec")}</strong>
                  <dl className="spec-list">
                    {p.spec.wordCountMin && p.spec.wordCountMax ? (
                      <>
                        <dt>{t("words")}</dt>
                        <dd>
                          {p.spec.wordCountMin}–{p.spec.wordCountMax}
                        </dd>
                      </>
                    ) : null}
                    <dt>{t("images")}</dt>
                    <dd>{p.spec.imagesMin ?? 0}</dd>
                    {p.spec.disclosureLabel ? (
                      <>
                        <dt>{t("disclosure")}</dt>
                        <dd>{p.spec.disclosureLabel}</dd>
                      </>
                    ) : null}
                  </dl>
                </div>
              ) : null}
              {p.bookable ? (
                <form action={addToPlan} style={{ marginTop: 12 }}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="productId" value={p.id} />
                  <SubmitButton
                    label={t("addToPlan")}
                    pendingLabel={t("addingToPlan")}
                  />
                </form>
              ) : (
                <p className="note">{t("unavailable")}</p>
              )}
            </article>
          );
        })}
        </div>
      )}

      {anyPriceVisible ? (
        <p className="note">{t("indicativeNote")}</p>
      ) : !titlePriceVisible ? (
        <p className="note">{tv("requestPriceHelp")}</p>
      ) : null}
    </section>
  );
}
