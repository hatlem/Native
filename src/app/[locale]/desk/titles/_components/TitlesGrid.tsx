import { getTranslations } from "next-intl/server";
import { MarketCode, Prisma } from "@prisma/client";
import { intlLocale } from "@/lib/money";
import { Link } from "@/i18n/navigation";
import {
  markTitleNative,
  markTitleNoNative,
  deactivateTitle,
} from "@/app/title-actions";
import { createPriceRequestsBulkAction } from "@/app/price-actions";
import { SubmitButton } from "@/components";
import type { FreshnessBucket } from "@/lib/pricing/freshness";

// Mirrors the include shape of the page's prisma.title.findMany query,
// plus the freshness fields computed in page.tsx.
export type TitleWithFreshness = Prisma.TitleGetPayload<{
  include: {
    publisher: true;
    market: true;
    _count: { select: { products: true } };
    products: { select: { confirmedAt: true } };
  };
}> & {
  freshness: FreshnessBucket;
  freshnessAgeDays: number | null;
};

type Props = {
  locale: string;
  byMarket: Map<MarketCode, TitleWithFreshness[]>;
};

export async function TitlesGrid({ locale, byMarket }: Props) {
  const t = await getTranslations({ locale, namespace: "deskTitles" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  return (
    <form action={createPriceRequestsBulkAction}>
      <input type="hidden" name="locale" value={locale} />
      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <SubmitButton
          label={t("bulk.sendPriceRequest")}
          pendingLabel={t("bulk.sending")}
        />
        <span className="muted" style={{ fontSize: "0.9em" }}>{t("bulk.hint")}</span>
      </div>
      {Array.from(byMarket.entries()).map(([mc, mTitles]) => (
      <div key={mc} style={{ marginTop: 24 }}>
        <h2>{tMarket(mc)}</h2>
        <div className="grid">
          {mTitles.map((title) => {
            const verified = title.lastVerifiedAt !== null;
            const hasNative = title.active;
            const declined = verified && !hasNative;
            const statusLabel = !verified
              ? t("status.unverified")
              : hasNative
                ? t("status.active")
                : t("status.no-native");

            return (
              <article className="card" key={title.id} style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <input
                    type="checkbox"
                    name="titleIds"
                    value={title.id}
                    style={{ marginTop: 4, flexShrink: 0 }}
                  />
                  <h3 style={{ margin: 0 }}>{title.name}</h3>
                </div>
                <div className="muted">
                  {title.publisher.name}
                  {title.ownerGroup &&
                  title.ownerGroup !== title.publisher.name
                    ? ` (${title.ownerGroup})`
                    : ""}{" "}
                  · {title.category}
                </div>
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
                    {title.type ? (
                      <span className="tag">{title.type}</span>
                    ) : null}
                    {title.frequency ? (
                      <span className="tag">{title.frequency}</span>
                    ) : null}
                    {title.b2bB2c ? (
                      <span className="tag">{title.b2bB2c}</span>
                    ) : null}
                    {title.format ? (
                      <span className="tag">{title.format}</span>
                    ) : null}
                    {title.nativeFit ? (
                      <span className="tag">
                        {t("nativeFitTag", { value: title.nativeFit })}
                      </span>
                    ) : null}
                    {title.reach ? (
                      <span className="tag">{title.reach}</span>
                    ) : null}
                  </div>
                ) : null}
                {title.vertical ? (
                  <div className="muted" style={{ marginTop: 6 }}>
                    {title.vertical}
                  </div>
                ) : null}
                {title.audience ? (
                  <div className="muted">{title.audience}</div>
                ) : null}
                {title.locationNote ? (
                  <div className="muted">📍 {title.locationNote}</div>
                ) : null}
                {title.adSales ? (
                  <div className="muted">
                    {t("adSales")}: {title.adSales}
                  </div>
                ) : null}
                {title.circulation ? (
                  <div className="muted">
                    {t("circulation")}:{" "}
                    {new Intl.NumberFormat(intlLocale(locale)).format(title.circulation)}
                  </div>
                ) : null}
                {title.monthlyReach ? (
                  <div className="muted">
                    {t("reach")}:{" "}
                    {new Intl.NumberFormat(intlLocale(locale)).format(title.monthlyReach)}
                  </div>
                ) : null}
                <div className="muted">
                  {t("products")}: {title._count.products}
                </div>
                {title.tags ? (
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      gap: 4,
                      flexWrap: "wrap",
                    }}
                  >
                    {title.tags
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((tag, i) => (
                        <span
                          key={i}
                          className="tag"
                          style={{ fontSize: "0.8em", opacity: 0.85 }}
                        >
                          #{tag}
                        </span>
                      ))}
                  </div>
                ) : null}
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <span className="tag">{statusLabel}</span>
                  {title.urlStatus ? (
                    <span className="tag">{title.urlStatus}</span>
                  ) : null}
                  <span
                    className="tag"
                    style={{
                      backgroundColor:
                        title.freshness === "fresh"
                          ? "#dcfce7"
                          : title.freshness === "aging"
                            ? "#fef9c3"
                            : "#fee2e2",
                      color:
                        title.freshness === "fresh"
                          ? "#166534"
                          : title.freshness === "aging"
                            ? "#854d0e"
                            : "#991b1b",
                    }}
                  >
                    {title.freshness === "never"
                      ? t("freshness.never")
                      : title.freshness === "stale"
                        ? t("freshness.stale", { days: title.freshnessAgeDays ?? 0 })
                        : title.freshness === "aging"
                          ? t("freshness.aging", { days: title.freshnessAgeDays ?? 0 })
                          : t("freshness.fresh", { days: title.freshnessAgeDays ?? 0 })}
                  </span>
                </div>
                {title.websiteUrl ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    <a
                      href={title.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("checkSite")} ↗
                    </a>
                  </div>
                ) : null}

                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link
                    href={`/desk/titles/${title.id}`}
                    className="btn small secondary"
                  >
                    {t("actions.edit")}
                  </Link>
                  {/* Per-card actions live INSIDE the bulk <form> — nested
                      <form> tags are invalid HTML, the parser drops them and
                      the buttons ended up submitting the outer form to a
                      broken action (desk couldn't deactivate anything,
                      2026-06-12). React 19 formAction buttons share the
                      outer form but route to their own server action, with
                      name/value carrying the per-card titleId. */}
                  {!hasNative ? (
                    <button
                      type="submit"
                      className="btn small secondary"
                      formAction={markTitleNative}
                      name="titleId"
                      value={title.id}
                    >
                      {t("actions.markNative")}
                    </button>
                  ) : null}
                  {!declined && !hasNative ? (
                    <button
                      type="submit"
                      className="btn small ghost"
                      formAction={markTitleNoNative}
                      name="titleId"
                      value={title.id}
                    >
                      {t("actions.markNoNative")}
                    </button>
                  ) : null}
                  {hasNative ? (
                    <button
                      type="submit"
                      className="btn small ghost"
                      formAction={deactivateTitle}
                      name="titleId"
                      value={title.id}
                    >
                      {t("actions.deactivate")}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    ))}
    </form>
  );
}
