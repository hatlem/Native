import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import {
  markTitleNative,
  markTitleNoNative,
  deactivateTitle,
} from "@/app/title-actions";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);
const STATUS_VALUES = ["all", "unverified", "active", "no-native"] as const;
type StatusFilter = (typeof STATUS_VALUES)[number];

function asMarket(value: string | undefined): MarketCode | undefined {
  return value && (MARKET_CODES as string[]).includes(value)
    ? (value as MarketCode)
    : undefined;
}

function asStatus(value: string | undefined): StatusFilter {
  return value && (STATUS_VALUES as readonly string[]).includes(value)
    ? (value as StatusFilter)
    : "all";
}

export default async function DeskTitlesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") {
    redirect(`/${locale}/desk`);
  }

  const t = await getTranslations({ locale, namespace: "deskTitles" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const td = await getTranslations({ locale, namespace: "desk" });

  const market = asMarket(typeof sp.market === "string" ? sp.market : undefined);
  const status = asStatus(typeof sp.status === "string" ? sp.status : undefined);

  const titles = await prisma.title.findMany({
    where: {
      ...(market ? { market: { code: market } } : {}),
      ...(status === "unverified" ? { lastVerifiedAt: null } : {}),
      ...(status === "active" ? { active: true } : {}),
      ...(status === "no-native"
        ? { active: false, lastVerifiedAt: { not: null } }
        : {}),
    },
    include: {
      publisher: true,
      market: true,
      _count: { select: { products: true } },
    },
    orderBy: [
      { market: { code: "asc" } },
      { publisher: { name: "asc" } },
      { name: "asc" },
    ],
  });

  const counts = await prisma.title.groupBy({
    by: ["active"],
    _count: { _all: true },
  });
  const totalActive = counts.find((c) => c.active)?._count._all ?? 0;
  const totalInactive = counts.find((c) => !c.active)?._count._all ?? 0;
  const unverifiedCount = await prisma.title.count({
    where: { lastVerifiedAt: null },
  });

  const byMarket = new Map<MarketCode, typeof titles>();
  for (const tt of titles) {
    const arr = byMarket.get(tt.market.code) ?? [];
    arr.push(tt);
    byMarket.set(tt.market.code, arr);
  }

  return (
    <>
      <nav className="breadcrumb">
        <Link href="/desk" className="small-link">
          ← {td("title")}
        </Link>
      </nav>

      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("subtitle")}</p>
      </header>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">{t("counts.active")}</div>
          <div className="value">{totalActive}</div>
          <div className="delta">{t("activeSub")}</div>
        </div>
        <div className="kpi">
          <div className="label">{t("counts.inactive")}</div>
          <div className="value">{totalInactive}</div>
          <div className="delta">{t("inactiveSub")}</div>
        </div>
        <div className={`kpi ${unverifiedCount > 0 ? "kpi-warn" : ""}`}>
          <div className="label">{t("counts.unverified")}</div>
          <div className="value">{unverifiedCount}</div>
          <div className="delta">{t("unverifiedSub")}</div>
        </div>
      </div>

      <form className="filters" method="get">
        <div>
          <label htmlFor="market">{t("filters.market")}</label>
          <select id="market" name="market" defaultValue={market ?? ""}>
            <option value="">{t("filters.all")}</option>
            {MARKET_CODES.map((m) => (
              <option key={m} value={m}>
                {tMarket(m)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status">{t("filters.status")}</label>
          <select id="status" name="status" defaultValue={status}>
            {STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit">{t("filters.apply")}</button>
      </form>

      {titles.length === 0 ? (
        <p className="note">{t("none")}</p>
      ) : (
        Array.from(byMarket.entries()).map(([mc, mTitles]) => (
          <section className="section" key={mc}>
            <div className="section-head">
              <div>
                <span className="eyebrow">{t("marketEyebrow")}</span>
                <h2>{tMarket(mc)}</h2>
              </div>
              <span className="muted small">
                {t("titleCount", { count: mTitles.length })}
              </span>
            </div>
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
                const tone = !verified
                  ? "badge-warning"
                  : hasNative
                    ? "badge-success"
                    : "badge-neutral";

                return (
                  <article className="card title-review-card" key={title.id}>
                    <div className="title-review-head">
                      <div>
                        <h3>{title.name}</h3>
                        <p className="muted small">{title.publisher.name}</p>
                      </div>
                      <span className={`badge ${tone} dotless`}>
                        {statusLabel}
                      </span>
                    </div>
                    {title.category ? (
                      <p className="muted small">{title.category}</p>
                    ) : null}
                    {title.monthlyReach ? (
                      <p className="muted small">
                        {t("reach")}:{" "}
                        {new Intl.NumberFormat(locale).format(
                          title.monthlyReach,
                        )}
                      </p>
                    ) : null}
                    <p className="muted small">
                      {t("products")}: {title._count.products}
                    </p>
                    {title.websiteUrl ? (
                      <p>
                        <a
                          href={title.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link"
                        >
                          {t("checkSite")} ↗
                        </a>
                      </p>
                    ) : null}
                    <div className="title-actions">
                      {!hasNative ? (
                        <form action={markTitleNative}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="titleId" value={title.id} />
                          <button type="submit" className="btn small">
                            {t("actions.markNative")}
                          </button>
                        </form>
                      ) : null}
                      {!declined && !hasNative ? (
                        <form action={markTitleNoNative}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="titleId" value={title.id} />
                          <button type="submit" className="btn small secondary">
                            {t("actions.markNoNative")}
                          </button>
                        </form>
                      ) : null}
                      {hasNative ? (
                        <form action={deactivateTitle}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="titleId" value={title.id} />
                          <button type="submit" className="btn small ghost">
                            {t("actions.deactivate")}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </>
  );
}
