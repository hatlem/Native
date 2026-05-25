import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import { ProductType } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { indicativeFromRules, toRateRules, formatMoney } from "@/lib/money";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600"],
});

const DESK_MAILTO =
  "mailto:desk@benative.example?subject=Talk%20to%20the%20BeNative%20desk";

export const metadata = {
  title: "BeNative — One brief. 240+ Nordic titles. Firm quote in 24 hours.",
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

  // All titles have a Market FK now (NOT NULL across all 9 catalog
  // countries — NO, SE, DK, FI, DE, AT, CH, UK, IE).
  const [sampleTitles, publishersRaw, totalActiveTitles, totalPublishers] =
    await Promise.all([
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
        where: { titles: { some: { active: true } } },
        include: {
          market: { select: { code: true } },
          titles: {
            where: { active: true },
            select: { market: { select: { code: true } } },
          },
        },
      }),
      prisma.title.count({ where: { active: true } }),
      prisma.publisher.count({
        where: { titles: { some: { active: true } } },
      }),
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
    <div className={`bn ${inter.variable}`} data-screen-label="01 Landing">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

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
                titles: totalActiveTitles,
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
                  {" — "}
                  {p.count} {t("pubs.titlesSuffix")}
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
          <div className="v">
            240
            <span style={{ fontSize: "0.5em", color: "var(--ink-mute)", fontWeight: 500 }}>
              +
            </span>
          </div>
          <div className="l">{t("stats.v240Label")}</div>
          <div className="sub">{t("stats.v240Sub")}</div>
        </div>
        <div className="cell">
          <div className="v">12</div>
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
          <div className="v">3</div>
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

      <footer className="page-foot">
        <div className="wrap">
          <div className="left">
            <div className="brand-foot">BeNative</div>
            <div className="copy">{t("foot.tagline")}</div>
            <div className="copy" style={{ marginTop: 8 }}>
              © <span className="roman">MMXXVI</span> · {t("foot.copy")}
            </div>
          </div>
          <nav aria-label="Footer">
            <Link href="/for-advertisers">{t("foot.navAdv")}</Link>
            <Link href="/for-agencies">{t("foot.navAgy")}</Link>
            <Link href="/for-publishers">{t("foot.navPub")}</Link>
            <Link href="/about">{t("foot.navAbout")}</Link>
            <a href={DESK_MAILTO}>{t("foot.navContact")}</a>
          </nav>
          <div className="markets">
            <span>
              <span className="flag no"></span>NO
            </span>
            <span>
              <span className="flag se"></span>SE
            </span>
            <span>
              <span className="flag dk"></span>DK
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

const STYLES = `
/* Keep the locale layout's site mega menu; reset main padding & hide the layout footer (landing has its own). */
body:has(.bn) > footer { display: none !important; }
body:has(.bn) main.container {
  max-width: none !important;
  padding: 0 !important;
  margin: 0 !important;
}

/* Reconcile the kept mega menu with the bone landing palette */
body:has(.bn) header.site-header {
  background: rgba(237, 232, 219, 0.88) !important;
  border-bottom: 2px solid #14110C !important;
}
body:has(.bn) header.site-header .brand { color: #14110C !important; }
body:has(.bn) header.site-header .nav a { color: #6B6452 !important; }
body:has(.bn) header.site-header .nav a:hover { color: #14110C !important; background: transparent !important; }
body:has(.bn) header.site-header .nav .muted { color: #6B6452 !important; }
body:has(.bn) header.site-header .nav form { border-left-color: rgba(20,17,12,0.2) !important; }
body:has(.bn) header.site-header .nav button {
  background: #14110C !important;
  color: #EDE8DB !important;
  border-color: #14110C !important;
  border-radius: 2px !important;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 12px;
}
body:has(.bn) header.site-header .nav button:hover { background: #3A3528 !important; }

.bn {
  --paper: #EDE8DB;
  --paper-2: #E4DECB;
  --ink: #14110C;
  --ink-soft: #3A3528;
  --ink-mute: #6B6452;
  --rule: #14110C;
  --hair: rgba(20,17,12,.18);
  --NO: #BA0C2F;
  --SE: #006AA7;
  --DK: #C8102E;
  --max: 1280px;
  --pad: clamp(20px, 4vw, 56px);

  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-inter), -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  font-feature-settings: "ss01" 1, "cv11" 1;
  font-weight: 400;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.bn, .bn * { box-sizing: border-box; }
.bn a { color: inherit; text-decoration: none; }
.bn ::selection { background: var(--ink); color: var(--paper); }

.bn .wrap { max-width: var(--max); margin: 0 auto; padding-left: var(--pad); padding-right: var(--pad); }

/* — Hero — tuned so the headline + CTAs + 3-5× side stat all sit
   above the fold on a 1366×768 laptop. */
.bn .hero {
  padding: clamp(28px, 3.6vw, 56px) 0 clamp(28px, 3.6vw, 56px);
  border-bottom: 2px solid var(--rule);
}
.bn .pain-row {
  display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap;
  margin-bottom: clamp(20px, 2.4vw, 36px);
}
.bn .label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
  color: var(--ink);
}
.bn .pain-row .label::after {
  content: ""; display: inline-block; width: 56px; height: 1px; background: var(--ink); margin-left: 16px; transform: translateY(-4px);
}
.bn .pain-line {
  font-size: clamp(14px, 1.1vw, 16px);
  color: var(--ink-soft);
  max-width: 64ch;
  line-height: 1.5;
  margin: 0;
}
.bn .pain-line strong { font-weight: 600; color: var(--ink); }

.bn h1.headline {
  font-weight: 600;
  font-size: clamp(40px, min(6.4vw, 8.4vh), 88px);
  line-height: 0.95;
  letter-spacing: -0.045em;
  margin: 0 0 clamp(24px, 2.6vw, 40px) 0;
  text-wrap: balance;
}
.bn h1.headline .row { display: block; }
.bn h1.headline .ink-mute { color: var(--ink-mute); }

.bn .hero-cluster {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: clamp(32px, 5vw, 80px);
  align-items: end;
}
.bn .ctas { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
.bn .btn {
  display: inline-flex; align-items: center; gap: 12px;
  padding: 13px 20px; border-radius: 2px;
  font-size: 13px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600;
  border: 2px solid var(--ink); background: transparent; color: var(--ink);
  cursor: pointer; transition: transform .15s ease;
}
.bn .btn:hover { transform: translateY(-1px); }
.bn .btn.primary {
  background: var(--ink); color: var(--paper);
  box-shadow: 6px 6px 0 0 var(--ink-mute);
}
.bn .btn.primary:hover { box-shadow: 8px 8px 0 0 var(--ink-mute); }
.bn .btn .arrow { font-weight: 400; font-size: 16px; line-height: 1; }
.bn .btn-meta { font-size: 12px; color: var(--ink-mute); letter-spacing: 0.04em; max-width: 28ch; }

.bn .hero-side {
  display: flex; flex-direction: column; gap: 14px;
  border-left: 2px solid var(--rule);
  padding-left: clamp(20px, 2.4vw, 36px);
}
.bn .hero-side .quote-num {
  font-size: clamp(40px, 4.2vw, 56px);
  font-weight: 600; letter-spacing: -0.04em; line-height: 1;
}
.bn .hero-side .quote-num .unit { font-size: 0.4em; font-weight: 500; color: var(--ink-mute); letter-spacing: 0; margin-left: 4px; vertical-align: 12px; }
.bn .hero-side p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--ink-soft); }

/* — Publishers band — */
.bn .pubs {
  padding: clamp(56px, 6vw, 96px) 0;
  border-bottom: 2px solid var(--rule);
}
.bn .pubs-head {
  display: flex; justify-content: space-between; align-items: baseline; gap: 24px; flex-wrap: wrap;
  margin-bottom: clamp(28px, 3vw, 44px);
}
.bn .pubs-head .label-lg {
  font-size: clamp(13px, 1vw, 14px); text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
}
.bn .pubs-head .meta { font-size: 12px; color: var(--ink-mute); letter-spacing: 0.04em; text-transform: uppercase; }
.bn .pubs-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--hair);
  border-left: 1px solid var(--hair);
}
.bn .pubs-grid .cell {
  padding: 24px 22px;
  border-right: 1px solid var(--hair);
  border-bottom: 1px solid var(--hair);
  display: flex; flex-direction: column; gap: 4px;
  min-height: 92px; justify-content: center;
}
.bn .pubs-grid .cell .pub-name {
  font-size: clamp(18px, 1.6vw, 22px); font-weight: 600; letter-spacing: -0.02em; line-height: 1.1;
}
.bn .pubs-grid .cell .pub-meta {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-mute); font-weight: 500;
}
.bn .flag { display: inline-block; width: 8px; height: 8px; margin-right: 6px; vertical-align: 1px; }
.bn .flag.no { background: var(--NO); }
.bn .flag.se { background: var(--SE); }
.bn .flag.dk { background: var(--DK); }

.bn .pubs-foot {
  margin-top: 22px;
  font-size: 13px;
  color: var(--ink-soft);
  letter-spacing: 0.02em;
}
.bn .pubs-foot .more {
  border-bottom: 1px solid var(--ink); padding-bottom: 1px;
}

/* — Catalog — */
.bn .catalog { padding: clamp(64px, 7vw, 104px) 0; border-bottom: 2px solid var(--rule); }
.bn .cat-head { display: flex; justify-content: space-between; align-items: end; gap: 24px; margin-bottom: clamp(28px, 3vw, 40px); flex-wrap: wrap; }
.bn .cat-head h2 {
  margin: 8px 0 0 0; font-weight: 600; font-size: clamp(28px, 3vw, 44px);
  letter-spacing: -0.025em; line-height: 1.05; max-width: 22ch;
}
.bn .cat-head .ask {
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600;
  border-bottom: 1px solid var(--ink); padding-bottom: 2px;
}

.bn .cat-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.bn .cat-table thead th {
  text-align: left;
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
  color: var(--ink-mute);
  padding: 12px 14px 12px 0;
  border-bottom: 2px solid var(--rule);
}
.bn .cat-table thead th.num { text-align: right; padding-right: 0; }
.bn .cat-table tbody td {
  padding: 14px 14px 14px 0;
  border-bottom: 1px solid var(--hair);
  font-size: 14px;
  vertical-align: middle;
}
.bn .cat-table tbody td.num { text-align: right; padding-right: 0; font-feature-settings: "tnum" 1; }
.bn .cat-table tbody tr:last-child td { border-bottom: none; }
.bn .cat-table .title-name { font-weight: 600; letter-spacing: -0.005em; }
.bn .cat-table .pub { color: var(--ink-mute); font-size: 12.5px; }
.bn .cat-table .cat-tag {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-mute); font-weight: 500;
}
.bn .cat-table tbody tr.active td {
  background: var(--ink); color: var(--paper);
  border-bottom-color: var(--ink);
}
.bn .cat-table tbody tr.active .pub,
.bn .cat-table tbody tr.active .cat-tag { color: rgba(237, 232, 219, .65); }
.bn .cat-table tbody tr.active td:first-child { padding-left: 14px; }
.bn .cat-table tbody tr.active td:last-child { padding-right: 14px; }

.bn .cat-foot {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-top: 22px; gap: 24px; flex-wrap: wrap;
  font-size: 13px; color: var(--ink-soft);
}
.bn .cat-foot .ind { font-size: 11px; color: var(--ink-mute); text-transform: uppercase; letter-spacing: 0.14em; font-weight: 500; }

/* — Stats band — */
.bn .stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-bottom: 2px solid var(--rule);
}
.bn .stats .cell {
  padding: clamp(40px, 4.4vw, 64px) clamp(20px, 2.6vw, 36px);
  border-right: 1px solid var(--hair);
  display: flex; flex-direction: column; gap: 8px;
}
.bn .stats .cell:last-child { border-right: none; }
.bn .stats .cell .v {
  font-size: clamp(48px, 5.8vw, 84px); font-weight: 600;
  letter-spacing: -0.04em; line-height: 0.95;
}
.bn .stats .cell .l {
  font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
  color: var(--ink);
}
.bn .stats .cell .sub {
  font-size: 13px; color: var(--ink-mute); line-height: 1.4; margin-top: 4px;
}

/* — How — */
.bn .how { padding: clamp(64px, 7vw, 104px) 0; border-bottom: 2px solid var(--rule); }
.bn .how-head { margin-bottom: clamp(36px, 4vw, 56px); max-width: 32ch; }
.bn .how-head h2 {
  margin: 8px 0 0 0; font-weight: 600; font-size: clamp(32px, 3.6vw, 56px);
  letter-spacing: -0.03em; line-height: 1.02;
}
.bn .how-cols {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}
.bn .how-cols .col {
  padding: 0 clamp(20px, 2.4vw, 36px);
  border-right: 1px solid var(--hair);
}
.bn .how-cols .col:first-child { padding-left: 0; }
.bn .how-cols .col:last-child { padding-right: 0; border-right: none; }
.bn .how-cols .step-num {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600; color: var(--ink-mute);
  margin-bottom: 16px;
}
.bn .how-cols h3 {
  margin: 0 0 12px 0; font-size: clamp(20px, 1.8vw, 26px); font-weight: 600; letter-spacing: -0.015em; line-height: 1.15;
}
.bn .how-cols p {
  margin: 0; font-size: 14px; line-height: 1.55; color: var(--ink-soft); max-width: 32ch;
}
.bn .how-cols .col-time {
  margin-top: 18px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-mute); font-weight: 500;
}

/* — Objections — */
.bn .obj { padding: clamp(64px, 7vw, 104px) 0; border-bottom: 2px solid var(--rule); }
.bn .obj-grid {
  display: grid; grid-template-columns: 1fr 2fr;
  gap: clamp(32px, 5vw, 80px);
}
.bn .obj h2 {
  margin: 0; font-weight: 600; font-size: clamp(32px, 3.6vw, 56px);
  letter-spacing: -0.03em; line-height: 1.02; max-width: 12ch;
}
.bn .obj .qas { display: grid; gap: 0; border-top: 1px solid var(--hair); }
.bn .obj .qa { padding: 22px 0; border-bottom: 1px solid var(--hair); display: grid; grid-template-columns: 1fr 1.8fr; gap: 32px; align-items: baseline; }
.bn .obj .qa .q {
  font-size: clamp(16px, 1.3vw, 18px); font-weight: 600; letter-spacing: -0.01em;
}
.bn .obj .qa .a {
  font-size: 14px; line-height: 1.55; color: var(--ink-soft);
}

/* — End CTA — */
.bn .end-cta {
  padding: clamp(80px, 9vw, 140px) 0;
  text-align: left;
  border-bottom: 2px solid var(--rule);
}
.bn .end-cta h2 {
  margin: 0 0 28px 0;
  font-weight: 600;
  font-size: clamp(40px, 5.4vw, 80px);
  letter-spacing: -0.04em; line-height: 0.98;
  max-width: 16ch;
}
.bn .end-cta p { margin: 0 0 36px 0; font-size: 15px; color: var(--ink-soft); max-width: 52ch; }
.bn .end-cta .row { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
.bn .end-cta .qual {
  font-size: 12px; color: var(--ink-mute); letter-spacing: 0.04em; max-width: 36ch;
}

/* — Page footer — */
.bn .page-foot { padding: 36px 0 56px; }
.bn .page-foot .wrap { display: flex; justify-content: space-between; align-items: end; gap: 32px; flex-wrap: wrap; }
.bn .page-foot .left { display: flex; flex-direction: column; gap: 6px; }
.bn .page-foot .brand-foot { font-weight: 600; letter-spacing: -0.02em; font-size: 17px; }
.bn .page-foot .copy { font-size: 11.5px; color: var(--ink-mute); letter-spacing: 0.14em; text-transform: uppercase; }
.bn .page-foot .copy .roman { font-variant-numeric: oldstyle-nums; }
.bn .page-foot nav { display: flex; gap: 28px; flex-wrap: wrap; }
.bn .page-foot nav a { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-soft); font-weight: 500; }
.bn .page-foot .markets { display: flex; gap: 14px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--ink-mute); font-weight: 500; }

/* — Why native works — */
.bn .why { padding: clamp(64px, 7vw, 104px) 0; border-bottom: 2px solid var(--rule); }
.bn .why-head {
  display: grid; grid-template-columns: 1.4fr 2fr;
  gap: clamp(32px, 5vw, 80px);
  align-items: end;
  margin-bottom: clamp(40px, 4.5vw, 64px);
}
.bn .why-head h2 {
  margin: 10px 0 0 0; font-weight: 600;
  font-size: clamp(32px, 3.6vw, 56px); letter-spacing: -0.03em; line-height: 1.02;
  max-width: 16ch;
}
.bn .why-head .lead {
  margin: 0; font-size: clamp(15px, 1.2vw, 17px); line-height: 1.55; color: var(--ink-soft); max-width: 50ch;
}
.bn .why-cols { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 2px solid var(--rule); }
.bn .why-cols .col {
  padding: 32px clamp(20px, 2.4vw, 36px) 36px;
  border-right: 1px solid var(--hair);
}
.bn .why-cols .col:first-child { padding-left: 0; }
.bn .why-cols .col:last-child { padding-right: 0; border-right: none; }
.bn .why-cols .ix {
  font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600;
  color: var(--ink-mute); margin-bottom: 22px;
}
.bn .why-cols h3 {
  margin: 0 0 14px 0; font-size: clamp(22px, 2vw, 28px); font-weight: 600;
  letter-spacing: -0.02em; line-height: 1.1; max-width: 16ch;
}
.bn .why-cols p {
  margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: var(--ink-soft); max-width: 36ch;
}
.bn .why-cols .pull {
  font-size: 12.5px; color: var(--ink-mute); letter-spacing: 0.01em;
  border-top: 1px solid var(--hair); padding-top: 14px; margin-top: 6px; max-width: 36ch;
  font-style: italic;
}
.bn .why-cols .pull strong { font-style: normal; color: var(--ink); font-weight: 600; }

/* — Vs display table — */
.bn .vs { padding: clamp(64px, 7vw, 104px) 0; border-bottom: 2px solid var(--rule); }
.bn .vs-head { margin-bottom: clamp(28px, 3vw, 40px); max-width: 32ch; }
.bn .vs-head h2 {
  margin: 8px 0 0 0; font-weight: 600;
  font-size: clamp(28px, 3vw, 44px); letter-spacing: -0.025em; line-height: 1.05;
}
.bn .vs-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.bn .vs-table thead th {
  text-align: left; padding: 14px 24px 14px 0;
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
  color: var(--ink-mute); border-bottom: 2px solid var(--rule);
}
.bn .vs-table thead th.native { color: var(--ink); }
.bn .vs-table thead th.spec { width: 22%; }
.bn .vs-table tbody td {
  padding: 22px 24px 22px 0; vertical-align: top;
  border-bottom: 1px solid var(--hair); font-size: 14.5px; line-height: 1.5;
}
.bn .vs-table tbody tr:last-child td { border-bottom: none; }
.bn .vs-table tbody td.spec {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; font-weight: 600;
  color: var(--ink-mute);
}
.bn .vs-table tbody td.native { color: var(--ink); font-weight: 500; }
.bn .vs-table tbody td.display { color: var(--ink-mute); }

/* — Golden rule — */
.bn .rule { background: var(--ink); color: var(--paper); padding: clamp(80px, 9vw, 140px) 0; border-bottom: 2px solid var(--rule); }
.bn .rule .wrap {
  display: grid; grid-template-columns: 1fr 1.7fr;
  gap: clamp(32px, 5vw, 80px);
  align-items: start;
}
.bn .rule .label-ix {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;
  color: rgba(237,232,219,.55);
}
.bn .rule h2 {
  margin: 12px 0 0 0; font-weight: 600;
  font-size: clamp(34px, 4vw, 64px); letter-spacing: -0.035em; line-height: 1.0;
  color: var(--paper); max-width: 14ch;
}
.bn .rule .body {
  margin: 0; font-size: clamp(16px, 1.4vw, 22px); line-height: 1.45;
  color: rgba(237,232,219,.88); max-width: 44ch;
  letter-spacing: -0.005em;
}
.bn .rule .body em { font-style: italic; color: var(--paper); }
.bn .rule .sig {
  margin-top: 28px;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: rgba(237,232,219,.55); font-weight: 500;
}

/* Responsive */
@media (max-width: 960px) {
  .bn .hero-cluster { grid-template-columns: 1fr; }
  .bn .hero-side { border-left: none; border-top: 2px solid var(--rule); padding-left: 0; padding-top: 24px; }
  .bn .pubs-grid { grid-template-columns: repeat(2, 1fr); }
  .bn .stats { grid-template-columns: repeat(2, 1fr); }
  .bn .stats .cell:nth-child(2) { border-right: none; }
  .bn .stats .cell:nth-child(-n+2) { border-bottom: 1px solid var(--hair); }
  .bn .how-cols { grid-template-columns: 1fr; }
  .bn .how-cols .col { border-right: none; border-bottom: 1px solid var(--hair); padding: 24px 0; }
  .bn .how-cols .col:last-child { border-bottom: none; }
  .bn .obj-grid { grid-template-columns: 1fr; }
  .bn .obj .qa { grid-template-columns: 1fr; gap: 8px; }
  .bn .cat-table .hide-md { display: none; }
  .bn .cat-table thead th.hide-md { display: none; }
  .bn .why-head { grid-template-columns: 1fr; }
  .bn .rule .wrap { grid-template-columns: 1fr; }
  .bn .why-cols { grid-template-columns: 1fr; }
  .bn .why-cols .col { border-right: none; border-bottom: 1px solid var(--hair); padding: 28px 0 32px; }
  .bn .why-cols .col:last-child { border-bottom: none; }
  .bn .vs-table { table-layout: auto; }
  .bn .vs-table tbody td.spec { width: auto; }
}
`;
