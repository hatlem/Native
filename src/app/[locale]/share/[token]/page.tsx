import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { approvalState, loadSharedList, planVersion, recordShareView } from "@/lib/list-share";
import { approveSharedPlan } from "@/app/share-actions";
import { formatMoney, intlLocale } from "@/lib/money";
import { titleDisplayName } from "@/lib/title-display";
import { loadPricingDefaults } from "@/lib/content-fee";
import { estimateListTotals, linePrice } from "@/lib/plan-total";

export const dynamic = "force-dynamic";

// The URL *is* the credential — keep it out of every index and out of
// referrer headers on any outbound click.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Read-only client view of a shared plan: what an agency forwards to their
// advertiser for sign-off. No sign-in, addressed purely by the unguessable
// token. Shows exactly what a proposal shows — lines, schedule, indicative
// prices, totals, the customer-visible line notes — and nothing desk- or
// org-internal (no internal list note, no margins, no emails: Cloudflare rewrites SSR'd emails and cascades React
// hydration errors, see SafeEmail).
//
// Prices and totals come from the same engine as /plan (lib/plan-total.ts,
// the order's own pricing), content fees and VAT included, so the client
// sees the figure the buyer sees. Lines keep the buyer's order.
export default async function SharedListPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const list = await loadSharedList(token);
  if (!list) notFound();
  // Engagement stamp for the owner's Share panel ("last opened by the
  // client…"). Deliberately awaited — a lost write here is a lie in the
  // panel, and it's one indexed UPDATE.
  await recordShareView(token);

  const t = await getTranslations({ locale, namespace: "shareList" });
  const tPlan = await getTranslations({ locale, namespace: "plan" });
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tv = await getTranslations({ locale, namespace: "priceVisibility" });
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const money = (amount: number, currency: string) => formatMoney(amount, currency, locale);

  const pricing = await loadPricingDefaults();
  const allTotals = estimateListTotals(list.items, pricing);
  const totals = allTotals.filter((r) => r.hasVisible);
  // Hidden-price lines and not-yet-placed titles add to the total later.
  const hasHidden =
    allTotals.some((r) => r.hasHidden) || list.items.some((i) => !i.isAlternative && !i.productId);

  // The version of the plan this page shows: the approve form posts it, so a
  // client only ever approves the lines they saw (lib/list-share.ts).
  const version = planVersion(list.items);
  const approval = approvalState(list, version);

  // One row per line in the buyer's order (sortOrder), product lines and
  // not-yet-placed titles interleaved exactly as on /plan.
  const row = (i: (typeof list.items)[number], inTotal: boolean): ReactNode => {
    if (i.productId && i.product) {
      const p = i.product;
      // Null when the price isn't shown: "on request", never a 0.
      const price = linePrice(i, pricing);
      return (
        <div className="share-list__line" key={i.id}>
          <div className="share-list__line-main">
            <div className="share-list__line-title">{titleDisplayName(p.title)}</div>
            <div className="muted small">
              {tType(p.type)} · {p.title.publisher.name}
              {inTotal && i.quantity > 1 ? ` · ${t("qty", { count: i.quantity })}` : ""}
              {inTotal && i.withContent ? ` · ${t("weWriteIt")}` : ""}
            </div>
            {inTotal && i.scheduleStart ? (
              <div className="muted small">{t("from", { date: dateFmt.format(i.scheduleStart) })}</div>
            ) : null}
            {i.notes ? (
              <p className="line-note__text">
                <span className="line-note__label">{t("noteLabel")}</span>
                {i.notes}
              </p>
            ) : null}
          </div>
          <div className="share-list__line-price">
            {price ? money(price.total, p.currency) : tv("requestPrice")}
          </div>
        </div>
      );
    }
    if (!i.title) return null;
    return (
      <div className="share-list__line" key={i.id}>
        <div className="share-list__line-main">
          <div className="share-list__line-title">{titleDisplayName(i.title)}</div>
          <div className="muted small">{t("placementTbd")}</div>
          {i.notes ? (
            <p className="line-note__text">
              <span className="line-note__label">{t("noteLabel")}</span>
              {i.notes}
            </p>
          ) : null}
        </div>
        <div className="share-list__line-price">{tv("requestPrice")}</div>
      </div>
    );
  };
  const planItems = list.items.filter((i) => !i.isAlternative);
  const altItems = list.items.filter((i) => i.isAlternative);

  return (
    <article className="share-list">
      <header className="share-list__header">
        <span className="eyebrow accent">{t("eyebrow", { org: list.organization.name })}</span>
        <h1>{list.name}</h1>
        {list.programme && list.waveNumber ? (
          <p className="muted">
            {t("waveNote", { n: list.waveNumber, of: list.programme.plannedWaves })}
            {list.article?.title ? ` · ${list.article.title}` : ""}
          </p>
        ) : null}
      </header>

      <div className="share-list__lines">{planItems.map((i) => row(i, true))}</div>

      <div className="share-list__totals">
        <span className="muted small">{t("totalLabel")}</span>
        {totals.length > 0 ? (
          totals.map((r) => (
            <div key={r.currency}>
              <strong>
                {money(r.amount, r.currency)} <span className="muted small">{tPlan("exVat")}</span>
              </strong>
              {r.contentFees > 0 ? (
                <p className="muted small">
                  {tPlan("includesContentFees", { amount: money(r.contentFees, r.currency) })}
                </p>
              ) : null}
              <p className="muted small">{tPlan("inclVatLine", { amount: money(r.totalInclVat, r.currency) })}</p>
            </div>
          ))
        ) : (
          <strong>{tv("requestPrice")}</strong>
        )}
        {hasHidden && totals.length > 0 ? <span className="muted small">{t("plusOnRequest")}</span> : null}
      </div>
      {altItems.length > 0 ? (
        <section className="share-list__alternatives">
          <h2 className="share-list__alternatives-heading">{t("alternativesHeading")}</h2>
          <p className="muted small">{t("alternativesIntro")}</p>
          <div className="share-list__lines">{altItems.map((i) => row(i, false))}</div>
        </section>
      ) : null}
      <p className="muted small share-list__disclaimer">{t("disclaimer")}</p>

      {approval.kind === "current" ? (
        <div className="share-list__approved" role="status">
          ✓ {t("approvedAt", { date: dateFmt.format(approval.approvedAt) })}
        </div>
      ) : (
        <form action={approveSharedPlan} className="share-list__approve">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="version" value={version} />
          {approval.kind === "stale" ? (
            <p className="share-list__changed" role="status">
              {t("changedSinceApproval", { date: dateFmt.format(approval.approvedAt) })}
            </p>
          ) : null}
          <p className="muted small">{t("approveHint")}</p>
          <button type="submit" className="btn">
            {approval.kind === "stale" ? t("approveAgainCta") : t("approveCta")}
          </button>
        </form>
      )}

      <footer className="share-list__footer">
        <span className="muted small">{t("footer")}</span>
      </footer>
    </article>
  );
}
