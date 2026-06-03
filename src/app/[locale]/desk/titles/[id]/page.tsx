import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import {
  updateTitlePricing,
  setPublisherPricesPublic,
} from "@/app/title-actions";
import { SalesContactsPanel } from "./_components/SalesContactsPanel";
import { PriceRequestsPanel } from "./_components/PriceRequestsPanel";
import { PendingQuotesPanel } from "./_components/PendingQuotesPanel";
import { ContactHistoryPanel } from "./_components/ContactHistoryPanel";
import { SubmitButton } from "@/components";

export const dynamic = "force-dynamic";

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

      <SalesContactsPanel
        locale={locale}
        titleId={title.id}
        publisherId={title.publisher.id}
      />

      <PriceRequestsPanel locale={locale} titleId={title.id} />

      <PendingQuotesPanel locale={locale} titleId={title.id} />

      <ContactHistoryPanel locale={locale} titleId={title.id} />
    </section>
  );
}
