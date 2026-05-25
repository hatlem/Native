import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { ProductType } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { indicativeFromRules, toRateRules, formatMoney } from "@/lib/money";
import { LandingShell } from "@/app/landing-shell";

const DESK_MAILTO =
  "mailto:desk@atnative.com?subject=Talk%20to%20the%20ATNative%20desk";

export const metadata = {
  title: "ATNative — One brief. 3,000+ titles across 9 European markets. Firm quote in 24 hours.",
};

export const dynamic = "force-dynamic";

const PRODUCT_TYPE_TO_FORMAT_KEY: Record<ProductType, string> = {
  [ProductType.NATIVE_ARTICLE]: "fmtNativeArticle",
  [ProductType.ADVERTORIAL]: "fmtSponsoredArticle",
  [ProductType.NATIVE_DISPLAY]: "fmtSponsoredContent",
  [ProductType.PACKAGE]: "fmtSponsoredArticleAds",
};

function formatReach(n: number | null | undefined): string {
  if (!n || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

const richTags = {
  strong: (chunks: ReactNode) => <strong>{chunks}</strong>,
  em: (chunks: ReactNode) => <em>{chunks}</em>,
};


export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });

  // Catalog reach: report the full catalogued size (3,000+ titles across
  // all 9 markets — NO, SE, DK, FI, DE, AT, CH, UK, IE), not only the
  // small subset already verified for instant booking. The sample table
  // still pulls from active titles with indicative pricing.
  const [
    sampleTitles,
    publishersRaw,
    totalActiveTitles,
    totalTitles,
    totalPublishers,
  ] = await Promise.all([
    prisma.title.findMany({
      where: {
        active: true,
        products: { some: { active: true, visibility: "INDICATIVE" } },
      },
      orderBy: [{ monthlyReach: "desc" }, { name: "asc" }],
      take: 8,
      include: {
        publisher: { select: { name: true } },
        market: { select: { code: true, currency: true } },
        products: {
          where: { active: true, visibility: "INDICATIVE" },
          orderBy: { basePrice: "asc" },
          include: { priceRules: true },
          take: 1,
        },
      },
    }),
    prisma.publisher.findMany({
      where: { titles: { some: {} } },
      include: {
        market: { select: { code: true } },
        titles: {
          select: { market: { select: { code: true } } },
        },
      },
    }),
    prisma.title.count({ where: { active: true } }),
    prisma.title.count(),
    prisma.publisher.count(),
  ]);

  const featuredId = sampleTitles[2]?.id;

  const topPublishers = publishersRaw
    .map((p) => {
      const markets = Array.from(
        new Set(p.titles.map((t) => t.market.code.toLowerCase())),
      ).sort();
      return {
        id: p.id,
        name: p.name,
        markets,
        count: p.titles.length,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <LandingShell locale={locale} screenLabel="01 Landing" withFooter={true}>
      {/* HERO */}
      <section className="hero">
        <div className="wrap">
          <div className="pain-row">
            <div>
              <span className="label">{t("hero.labelText")}</span>
            </div>
            <p className="pain-line">{t.rich("hero.pain", richTags)}</p>
          </div>

          <h1 className="headline">
            <span className="row">{t("hero.h1Line1")}</span>
            <span className="row">{t("hero.h1Line2")}</span>
            <span className="row ink-mute">{t("hero.h1Line3")}</span>
            <span className="row ink-mute">{t("hero.h1Line4")}</span>
          </h1>

          <div className="hero-cluster">
            <div>
              <div className="ctas">
                <a href="#request" className="btn primary">
                  {t("hero.ctaPrimary")} <span className="arrow">→</span>
                </a>
                <a href="#how" className="btn">
                  {t("hero.ctaSecondary")}
                </a>
              </div>
              <p className="btn-meta" style={{ marginTop: 18 }}>
                {t("hero.ctaMeta")}
              </p>
            </div>

            <aside className="hero-side" aria-label={t("hero.sideAria")}>
              <div className="quote-num">
                3–5<span className="unit">×</span>
              </div>
              <p>{t("hero.sideBody")}</p>
            </aside>
          </div>
        </div>
      </section>

      {/* WHY */}
      <section className="why" id="why">
        <div className="wrap">
          <div className="why-head">
            <div>
              <div className="label">{t("why.labelText")}</div>
              <h2>{t("why.h2")}</h2>
            </div>
            <p className="lead">{t("why.lead")}</p>
          </div>

          <div className="why-cols">
            <div className="col">
              <div className="ix">{t("why.colAIx")}</div>
              <h3>{t("why.colAH3")}</h3>
              <p>{t.rich("why.colABody", richTags)}</p>
              <div className="pull">{t.rich("why.colAPull", richTags)}</div>
            </div>
            <div className="col">
              <div className="ix">{t("why.colBIx")}</div>
              <h3>{t("why.colBH3")}</h3>
              <p>{t.rich("why.colBBody", richTags)}</p>
              <div className="pull">{t.rich("why.colBPull", richTags)}</div>
            </div>
            <div className="col">
              <div className="ix">{t("why.colCIx")}</div>
              <h3>{t("why.colCH3")}</h3>
              <p>{t.rich("why.colCBody", richTags)}</p>
              <div className="pull">{t("why.colCPull")}</div>
            </div>
          </div>
        </div>
      </section>

      {/* VS DISPLAY */}
      <section className="vs">
        <div className="wrap">
          <div className="vs-head">
            <div className="label">{t("vs.labelText")}</div>
            <h2>{t("vs.h2")}</h2>
          </div>

          <table className="vs-table" aria-label={t("vs.labelText")}>
            <thead>
              <tr>
                <th className="spec">&nbsp;</th>
                <th className="native">{t("vs.thNative")}</th>
                <th>{t("vs.thDisplay")}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  "primaryJob",
                  "readerBehaviour",
                  "realEstate",
                  "trustTransfer",
                  "longevity",
                  "bestFit",
                ] as const
              ).map((k) => (
                <tr key={k}>
                  <td className="spec">{t(`vs.${k}Spec`)}</td>
                  <td className="native">{t(`vs.${k}Native`)}</td>
                  <td className="display">{t(`vs.${k}Display`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* GOLDEN RULE */}
      <section className="rule">
        <div className="wrap">
          <div>
            <div className="label-ix">{t("rule.labelIx")}</div>
            <h2>{t("rule.h2")}</h2>
          </div>
          <div>
            <p className="body">{t.rich("rule.body", richTags)}</p>
            <div className="sig">{t("rule.sig")}</div>
          </div>
        </div>
      </section>

      {/* PUBLISHERS */}
      <section className="pubs" id="publishers">
        <div className="wrap">
          <div className="pubs-head">
            <div>
              <div className="label-lg">{t("pubs.labelText")}</div>
            </div>
            <div className="meta">
              {t("pubs.meta", {
                publishers: totalPublishers,
                titles: totalTitles,
                active: totalActiveTitles,
              })}
            </div>
          </div>

          <div
            className="pubs-grid"
            role="list"
            aria-label={t("pubs.labelText")}
          >
            {topPublishers.map((p) => (
              <div className="cell" role="listitem" key={p.id}>
                <div className="pub-name">{p.name}</div>
                <div className="pub-meta">
                  {p.markets.map((m, i, arr) => (
                    <span key={m}>
                      <span className={`flag ${m}`}></span>
                      {m.toUpperCase()}
                      {i < arr.length - 1 ? " · " : ""}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="pubs-foot">
            {t("pubs.foot")}{" "}
            <a href="#request" className="more">
              {t("pubs.footMore")}
            </a>
          </p>
        </div>
      </section>

      {/* CATALOG SAMPLE */}
      <section className="catalog" id="catalog">
        <div className="wrap">
          <div className="cat-head">
            <div>
              <div className="label">{t("catalog.labelText")}</div>
              <h2>{t("catalog.h2")}</h2>
            </div>
            <a href="#request" className="ask">
              {t("catalog.ask")}
            </a>
          </div>

          <table className="cat-table" aria-label={t("catalog.labelText")}>
            <thead>
              <tr>
                <th>{t("catalog.thTitle")}</th>
                <th className="hide-md">{t("catalog.thPublisher")}</th>
                <th>{t("catalog.thMarket")}</th>
                <th className="hide-md">{t("catalog.thFormat")}</th>
                <th className="hide-md">{t("catalog.thAudience")}</th>
                <th className="num">{t("catalog.thFrom")}</th>
              </tr>
            </thead>
            <tbody>
              {sampleTitles.map((title) => {
                const product = title.products[0];
                const indicative = product
                  ? indicativeFromRules(
                      Number(product.basePrice),
                      toRateRules(product.priceRules),
                    )
                  : null;
                const formatKey = product
                  ? PRODUCT_TYPE_TO_FORMAT_KEY[product.type]
                  : "fmtNativeArticle";
                const marketCodeUpper = title.market.code;
                const marketCode = marketCodeUpper.toLowerCase();
                const currency = title.market.currency;
                return (
                  <tr
                    key={title.id}
                    className={title.id === featuredId ? "active" : undefined}
                  >
                    <td>
                      <div className="title-name">{title.name}</div>
                      <div className="pub">{title.publisher.name}</div>
                    </td>
                    <td className="hide-md">
                      <span className="cat-tag">
                        {title.category}
                      </span>
                    </td>
                    <td>
                      <span className={`flag ${marketCode}`}></span>
                      {marketCodeUpper}
                    </td>
                    <td className="hide-md">
                      <span className="cat-tag">{t(`catalog.${formatKey}`)}</span>
                    </td>
                    <td className="hide-md num">
                      {formatReach(title.monthlyReach)}{" "}
                      {t("catalog.readersSuffix")}
                    </td>
                    <td className="num">
                      {indicative !== null
                        ? formatMoney(indicative, currency, locale)
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="cat-foot">
            <div>{t("catalog.footBody")}</div>
            <div className="ind">{t("catalog.footInd")}</div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="stats" aria-label={t("hero.sideAria")}>
        <div className="cell">
          <div className="v">{totalTitles.toLocaleString(locale)}</div>
          <div className="l">{t("stats.v240Label")}</div>
          <div className="sub">{t("stats.v240Sub")}</div>
        </div>
        <div className="cell">
          <div className="v">{totalPublishers.toLocaleString(locale)}</div>
          <div className="l">{t("stats.v12Label")}</div>
          <div className="sub">{t("stats.v12Sub")}</div>
        </div>
        <div className="cell">
          <div className="v">
            24
            <span style={{ fontSize: "0.5em", color: "var(--ink-mute)", fontWeight: 500 }}>
              {" "}
              {t("stats.v24Unit")}
            </span>
          </div>
          <div className="l">{t("stats.v24Label")}</div>
          <div className="sub">{t("stats.v24Sub")}</div>
        </div>
        <div className="cell">
          <div className="v">9</div>
          <div className="l">{t("stats.v3Label")}</div>
          <div className="sub">{t("stats.v3Sub")}</div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="how" id="how">
        <div className="wrap">
          <div className="how-head">
            <div className="label">{t("how.labelText")}</div>
            <h2>{t("how.h2")}</h2>
          </div>

          <div className="how-cols">
            {([1, 2, 3] as const).map((n) => (
              <div className="col" key={n}>
                <div className="step-num">{t(`how.s${n}Num`)}</div>
                <h3>{t(`how.s${n}H3`)}</h3>
                <p>{t(`how.s${n}Body`)}</p>
                <div className="col-time">{t(`how.s${n}Time`)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* OBJECTIONS */}
      <section className="obj">
        <div className="wrap">
          <div className="obj-grid">
            <h2>{t("obj.h2")}</h2>
            <div className="qas">
              {([1, 2, 3, 4, 5] as const).map((n) => (
                <div className="qa" key={n}>
                  <div className="q">{t(`obj.q${n}`)}</div>
                  <div className="a">{t.rich(`obj.a${n}`, richTags)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* END CTA */}
      <section className="end-cta" id="request">
        <div className="wrap">
          <h2>{t("endCta.h2")}</h2>
          <p>{t("endCta.body")}</p>
          <div className="row">
            <a href={DESK_MAILTO} className="btn primary">
              {t("endCta.ctaPrimary")} <span className="arrow">→</span>
            </a>
            <Link href="/signup" className="btn">
              {t("endCta.ctaSecondary")}
            </Link>
            <p className="qual" style={{ margin: "0 0 0 8px" }}>
              {t("endCta.qualPrefix")}{" "}
              <Link
                href="/for-publishers"
                style={{
                  borderBottom: "1px solid var(--ink-soft)",
                  paddingBottom: 1,
                }}
              >
                {t("endCta.qualLink")}
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
