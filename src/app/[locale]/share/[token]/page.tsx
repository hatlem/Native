import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { loadSharedList, recordShareView } from "@/lib/list-share";
import { approveSharedPlan } from "@/app/share-actions";
import { formatMoney, indicativeFromRules, toRateRules, intlLocale } from "@/lib/money";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { titleDisplayName } from "@/lib/title-display";

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
// prices, totals — and nothing desk- or org-internal (no internal note, no
// margins, no emails: Cloudflare rewrites SSR'd emails and cascades React
// hydration errors, see SafeEmail).
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
  const tType = await getTranslations({ locale, namespace: "productType" });
  const tv = await getTranslations({ locale, namespace: "priceVisibility" });
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  // Same price maths and visibility rules as /plan: visible-price lines show
  // their indicative total, hidden-price lines say "on request" — the client
  // sees what their agency sees, never more.
  const lines = list.items
    .filter((i) => i.productId && i.product)
    .map((i) => {
      const p = i.product!;
      const priceVisible = isProductPriceShown(p, p.title);
      const unit = priceVisible
        ? indicativeFromRules(Number(p.basePrice), toRateRules(p.priceRules), i.quantity)
        : 0;
      return {
        id: i.id,
        name: titleDisplayName(p.title),
        publisher: p.title.publisher.name,
        type: tType(p.type),
        quantity: i.quantity,
        withContent: i.withContent,
        scheduleStart: i.scheduleStart,
        priceVisible,
        currency: p.currency,
        lineTotal: unit * i.quantity,
      };
    });
  const placeholders = list.items.filter((i) => !i.productId && i.title);

  const totals = new Map<string, number>();
  let hasHidden = placeholders.length > 0;
  for (const l of lines) {
    if (!l.priceVisible) {
      hasHidden = true;
      continue;
    }
    totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.lineTotal);
  }

  return (
    <main className="share-list">
      <header className="share-list__header">
        <span className="eyebrow accent">{t("eyebrow", { org: list.organization.name })}</span>
        <h1>{list.name}</h1>
        {list.programme && list.waveNumber ? (
          <p className="muted">
            {t("waveNote", { n: list.waveNumber, of: list.programme.plannedWaves })}
            {list.articleAngle ? ` · ${list.articleAngle}` : ""}
          </p>
        ) : null}
      </header>

      <div className="share-list__lines">
        {lines.map((l) => (
          <div className="share-list__line" key={l.id}>
            <div className="share-list__line-main">
              <div className="share-list__line-title">{l.name}</div>
              <div className="muted small">
                {l.type} · {l.publisher}
                {l.quantity > 1 ? ` · ${t("qty", { count: l.quantity })}` : ""}
                {l.withContent ? ` · ${t("weWriteIt")}` : ""}
              </div>
              {l.scheduleStart ? (
                <div className="muted small">{t("from", { date: dateFmt.format(l.scheduleStart) })}</div>
              ) : null}
            </div>
            <div className="share-list__line-price">
              {l.priceVisible ? formatMoney(l.lineTotal, l.currency, locale) : tv("requestPrice")}
            </div>
          </div>
        ))}
        {placeholders.map((i) => (
          <div className="share-list__line" key={i.id}>
            <div className="share-list__line-main">
              <div className="share-list__line-title">{titleDisplayName(i.title!)}</div>
              <div className="muted small">{t("placementTbd")}</div>
            </div>
            <div className="share-list__line-price">{tv("requestPrice")}</div>
          </div>
        ))}
      </div>

      <div className="share-list__totals">
        <span className="muted small">{t("totalLabel")}</span>
        <strong>
          {totals.size > 0
            ? [...totals.entries()].map(([cur, amt]) => formatMoney(amt, cur, locale)).join(" + ")
            : tv("requestPrice")}
        </strong>
        {hasHidden && totals.size > 0 ? <span className="muted small">{t("plusOnRequest")}</span> : null}
      </div>
      <p className="muted small share-list__disclaimer">{t("disclaimer")}</p>

      {list.clientApprovedAt ? (
        <div className="share-list__approved" role="status">
          ✓ {t("approvedAt", { date: dateFmt.format(list.clientApprovedAt) })}
        </div>
      ) : (
        <form action={approveSharedPlan} className="share-list__approve">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="token" value={token} />
          <p className="muted small">{t("approveHint")}</p>
          <button type="submit" className="btn">
            {t("approveCta")}
          </button>
        </form>
      )}

      <footer className="share-list__footer">
        <span className="muted small">{t("footer")}</span>
      </footer>
    </main>
  );
}
