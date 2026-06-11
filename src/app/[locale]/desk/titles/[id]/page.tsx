import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import {
  updateTitlePricing,
  setPublisherPricesPublic,
  updateTitleProductionFee,
  updateProductPricing,
} from "@/app/title-actions";
import { SalesContactsPanel } from "./_components/SalesContactsPanel";
import { PriceRequestsPanel } from "./_components/PriceRequestsPanel";
import { PendingQuotesPanel } from "./_components/PendingQuotesPanel";
import { ContactHistoryPanel } from "./_components/ContactHistoryPanel";
import { RateCardsPanel } from "./_components/RateCardsPanel";
import { SubmitButton } from "@/components";

export const dynamic = "force-dynamic";

// Read-only display of the structured commercial/editorial profile we
// capture from publisher replies (offersNativeContent is the core
// dimension). Everything is on the title row already; this surfaces it so
// admins can see all captured data in one place. Consumer surfaces never
// render these fields — see catalog price gating + the `discontinuedAt`
// hide-filter.
function CommercialProfileCard({
  title,
}: {
  title: Awaited<ReturnType<typeof prisma.title.findUnique>> & object;
}) {
  const t = title as Record<string, unknown>;
  const yesNo = (v: unknown) =>
    v === true ? "Ja" : v === false ? "Nei" : "Ukjent";
  const arr = (v: unknown) => (Array.isArray(v) && v.length ? v.join(", ") : "—");
  const val = (v: unknown) => (v == null || v === "" ? "—" : String(v));
  const offers = t.offersNativeContent;
  const discontinuedAt = t.discontinuedAt as Date | null;
  const pricingAsOf = t.pricingAsOf as Date | null;
  const extra = t.commercialExtra;
  const dateOnly = (d: Date | null) =>
    d ? new Date(d).toISOString().slice(0, 10) : "—";

  const rows: [string, string][] = [
    ["Prisdata fra (dato)", dateOnly(pricingAsOf)],
    ["Sist verifisert", dateOnly(t.lastVerifiedAt as Date | null)],
    ["Tilbyr annonsørinnhold", yesNo(offers)],
    ["Egne artikler (ownContent)", val(t.ownContentAllowed)],
    ["Innholdspolicy", val(t.contentPolicy)],
    ["Beskrivelse", val(t.description)],
    ["Nøkkelord", arr(t.keywords)],
    ["Alias", arr(t.aliases)],
    ["Mangler (outstanding)", arr(t.outstandingInfo)],
    ["Digital rekkevidde", val(t.digitalReach)],
    ["Månedlig rekkevidde", val(t.monthlyReach)],
    ["Opplag", val(t.circulation)],
    ["Facebook-følgere", val(t.facebookFollowers)],
    ["Instagram-følgere", val(t.instagramFollowers)],
    [
      "Byråprovisjon",
      t.agencyCommissionPct != null ? `${Number(t.agencyCommissionPct)} %` : "—",
    ],
  ];

  return (
    <article className="card" style={{ marginTop: 16 }}>
      <h2>Publikasjonsdata</h2>
      <p className="muted small">
        Strukturert kommersiell/redaksjonell profil fanget fra svar. Vises kun
        på desk – aldri for forbruker.
      </p>
      {!t.active ? (
        <div className="banner-error" role="status" style={{ marginBottom: 12 }}>
          <span>
            Deaktivert
            {discontinuedAt
              ? ` · nedlagt ${new Date(discontinuedAt).toISOString().slice(0, 10)}`
              : ""}
            {t.discontinuedNote ? ` — ${String(t.discontinuedNote)}` : ""}
          </span>
        </div>
      ) : null}
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(180px, 240px) 1fr",
          gap: "6px 16px",
          margin: 0,
        }}
      >
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt className="muted small">{k}</dt>
            <dd style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      {extra != null && Object.keys(extra as object).length > 0 ? (
        <details style={{ marginTop: 12 }}>
          <summary className="muted small">
            Øvrig (commercialExtra — ustrukturert)
          </summary>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 12,
              background: "var(--surface-2, #f6f6f6)",
              padding: 12,
              borderRadius: 6,
              marginTop: 8,
            }}
          >
            {JSON.stringify(extra, null, 2)}
          </pre>
        </details>
      ) : null}
    </article>
  );
}

// Desk-side editor for the two buyer-facing pricing levers we added
// alongside the quote-narrative template:
//
//   - publishedRateCard / publishedRateCurrency — the publisher's
//     official media-kit price. Surfaces as the strikethrough anchor
//     on every quote line ("Rate card €30k → your price €18k"). The
//     biggest perception lever; quotes without it look like markup.
//
//   - pricesPublic — per-title visibility switch. Off → catalog and
//     public API hide every € figure and surface "Request price".
//     AND-ed with publisher.pricesPublic; we surface the publisher
//     toggle on the same page so the desk can see and flip both.
//
// Super-admin only, audited via the actions in title-actions.ts.
export default async function DeskTitleEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") {
    redirect(`/${locale}/desk`);
  }

  const title = await prisma.title.findUnique({
    where: { id },
    include: {
      publisher: true,
      market: true,
      // priceRules included so the per-product margin override renders
      // its current "default"-labeled value (blank = inherit).
      products: {
        include: { priceRules: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!title) notFound();

  const t = await getTranslations({ locale, namespace: "titleAdmin" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  const saved = typeof sp.saved === "string" ? sp.saved : null;
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <section>
      <p>
        <Link href="/desk/titles">← {t("cancel")}</Link>
      </p>
      <h1>
        {t("title")} · {title.name}
      </h1>
      <p className="muted">
        {title.publisher.name} · {tMarket(title.market.code)} ·{" "}
        {title.category}
      </p>

      {saved === "1" ? (
        <div className="banner-success" role="status">
          <span>✓ {t("saved")}</span>
        </div>
      ) : saved === "publisher" ? (
        <div className="banner-success" role="status">
          <span>
            ✓ {t("saved")} ({t("publisherPricesPublic").toLowerCase()})
          </span>
        </div>
      ) : null}
      {error === "invalid-rate" ? (
        <div className="banner-error" role="alert">
          <span>{t("publishedRateCardHelp")}</span>
        </div>
      ) : error === "invalid-fee" ? (
        <div className="banner-error" role="alert">
          <span>{t("productionFeeDefaultHelp")}</span>
        </div>
      ) : error === "invalid-pricing" ? (
        <div className="banner-error" role="alert">
          <span>
            {t("marginPctHelp")} {t("productionFeeHelp")}
          </span>
        </div>
      ) : null}

      <article className="card" style={{ marginTop: 16 }}>
        <form action={updateTitlePricing} className="product-form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="titleId" value={title.id} />

          <div className="field">
            <label htmlFor="publishedRateCard">{t("publishedRateCard")}</label>
            <input
              id="publishedRateCard"
              name="publishedRateCard"
              type="number"
              min="0"
              step="100"
              defaultValue={
                title.publishedRateCard != null
                  ? Number(title.publishedRateCard).toString()
                  : ""
              }
              placeholder="0"
            />
            <p className="muted small">{t("publishedRateCardHelp")}</p>
          </div>

          <div className="field">
            <label htmlFor="publishedRateCurrency">
              {t("publishedRateCurrency")}
            </label>
            <input
              id="publishedRateCurrency"
              name="publishedRateCurrency"
              type="text"
              maxLength={3}
              defaultValue={
                title.publishedRateCurrency ?? title.market.currency
              }
              placeholder={title.market.currency}
              style={{ textTransform: "uppercase", maxWidth: 120 }}
            />
          </div>

          <div className="field">
            <label
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <input
                type="checkbox"
                name="pricesPublic"
                value="1"
                defaultChecked={title.pricesPublic}
              />
              {t("pricesPublic")}
            </label>
            <p className="muted small">{t("pricesPublicHelp")}</p>
          </div>

          <SubmitButton
            label={t("save")}
            pendingLabel={t("saving")}
            className="btn"
          />
        </form>
      </article>

      <article className="card" style={{ marginTop: 16 }}>
        <h2>{t("publisherPricesPublic")}</h2>
        <p className="muted small">
          {title.publisher.pricesPublic
            ? t("publisherPricesPublicOn")
            : t("publisherPricesPublicOff")}
        </p>
        <form
          action={setPublisherPricesPublic}
          style={{ marginTop: 12 }}
        >
          <input type="hidden" name="locale" value={locale} />
          <input
            type="hidden"
            name="publisherId"
            value={title.publisher.id}
          />
          <input type="hidden" name="titleId" value={title.id} />
          <label
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <input
              type="checkbox"
              name="pricesPublic"
              value="1"
              defaultChecked={title.publisher.pricesPublic}
            />
            {t("pricesPublic")} ({title.publisher.name})
          </label>
          <div style={{ marginTop: 12 }}>
            <SubmitButton
              label={t("save")}
              pendingLabel={t("saving")}
              className="btn small"
            />
          </div>
        </form>
      </article>

      {/* Fee/margin override cascade, desk side. Title level sits in the
          middle of the fee cascade (Product.productionFee →
          Title.productionFeeDefault → ContentFeeRule); the per-product
          rows below are the most-specific layer for both fee and
          commission. Blank = inherit; explicit 0 = publisher includes
          production. */}
      <article className="card" style={{ marginTop: 16 }}>
        <form action={updateTitleProductionFee} className="product-form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="titleId" value={title.id} />

          <div className="field">
            <label htmlFor="productionFeeDefault">
              {t("productionFeeDefault")}
            </label>
            <input
              id="productionFeeDefault"
              name="productionFeeDefault"
              type="number"
              min="0"
              step="100"
              defaultValue={
                title.productionFeeDefault != null
                  ? Number(title.productionFeeDefault).toString()
                  : ""
              }
            />
            <p className="muted small">{t("productionFeeDefaultHelp")}</p>
          </div>

          <SubmitButton
            label={t("savePricing")}
            pendingLabel={t("savingPricing")}
            className="btn"
          />
        </form>
      </article>

      {title.products.length > 0 ? (
        <article className="card" style={{ marginTop: 16 }}>
          <h2>{t("productPricing")}</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
            {title.products.map((product) => {
              const defaultRule = product.priceRules.find(
                (r) => r.label === "default",
              );
              return (
                <li
                  key={product.id}
                  style={{
                    padding: "12px 0",
                    borderBottom: "1px solid var(--border, #e5e7eb)",
                  }}
                >
                  <strong>{product.name}</strong>{" "}
                  <span className="muted small">
                    {product.type} · {Number(product.basePrice)}{" "}
                    {product.currency}
                    {product.active ? "" : " · inactive"}
                  </span>
                  <form
                    action={updateProductPricing}
                    className="product-form"
                    style={{ marginTop: 8 }}
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <input
                      type="hidden"
                      name="productId"
                      value={product.id}
                    />

                    <div className="field">
                      <label htmlFor={`marginPct-${product.id}`}>
                        {t("marginPct")}
                      </label>
                      <input
                        id={`marginPct-${product.id}`}
                        name="marginPct"
                        type="number"
                        min="0"
                        max="95"
                        step="0.5"
                        defaultValue={
                          defaultRule != null
                            ? Number(defaultRule.marginPct).toString()
                            : ""
                        }
                      />
                      <p className="muted small">{t("marginPctHelp")}</p>
                    </div>

                    <div className="field">
                      <label htmlFor={`productionFee-${product.id}`}>
                        {t("productionFee")}
                      </label>
                      <input
                        id={`productionFee-${product.id}`}
                        name="productionFee"
                        type="number"
                        min="0"
                        step="100"
                        defaultValue={
                          product.productionFee != null
                            ? Number(product.productionFee).toString()
                            : ""
                        }
                      />
                      <p className="muted small">{t("productionFeeHelp")}</p>
                    </div>

                    <SubmitButton
                      label={t("savePricing")}
                      pendingLabel={t("savingPricing")}
                      className="btn small"
                    />
                  </form>
                </li>
              );
            })}
          </ul>
        </article>
      ) : null}

      <CommercialProfileCard title={title} />

      <SalesContactsPanel
        locale={locale}
        titleId={title.id}
        publisherId={title.publisher.id}
      />

      <PriceRequestsPanel locale={locale} titleId={title.id} />

      <PendingQuotesPanel locale={locale} titleId={title.id} />

      <ContactHistoryPanel locale={locale} titleId={title.id} />

      <RateCardsPanel locale={locale} titleId={title.id} />
    </section>
  );
}
