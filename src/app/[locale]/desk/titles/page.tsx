import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import {
  markTitleNative,
  markTitleNoNative,
  deactivateTitle,
} from "@/app/title-actions";

export const dynamic = "force-dynamic";

// All catalog countries — the NO/SE/DK Markets we sell into plus the
// research-catalog imports from prisma/data/medier_alle.csv.
const COUNTRY_CODES = [
  "NO",
  "SE",
  "DK",
  "FI",
  "DE",
  "AT",
  "CH",
  "UK",
  "IE",
] as const;
type CountryCode = (typeof COUNTRY_CODES)[number];
const STATUS_VALUES = ["all", "unverified", "active", "no-native"] as const;
type StatusFilter = (typeof STATUS_VALUES)[number];

function asCountry(value: string | undefined): CountryCode | undefined {
  return value && (COUNTRY_CODES as readonly string[]).includes(value)
    ? (value as CountryCode)
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

  const country = asCountry(
    typeof sp.market === "string" ? sp.market : undefined,
  );
  const status = asStatus(typeof sp.status === "string" ? sp.status : undefined);

  const titles = await prisma.title.findMany({
    where: {
      ...(country ? { countryCode: country } : {}),
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
      { countryCode: "asc" },
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

  // Group by country for display. Uses countryCode (always set) rather
  // than the optional Market FK so research-catalog titles render too.
  const byCountry = new Map<string, typeof titles>();
  for (const tt of titles) {
    const arr = byCountry.get(tt.countryCode) ?? [];
    arr.push(tt);
    byCountry.set(tt.countryCode, arr);
  }

  return (
    <section>
      <p>
        <Link href="/desk">← {td("title")}</Link>
      </p>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <div className="grid">
        <article className="card">
          <h3>{t("counts.active")}</h3>
          <div className="price">{totalActive}</div>
        </article>
        <article className="card">
          <h3>{t("counts.inactive")}</h3>
          <div className="price">{totalInactive}</div>
        </article>
        <article className="card">
          <h3>{t("counts.unverified")}</h3>
          <div className="price">{unverifiedCount}</div>
        </article>
      </div>

      <form className="filters" method="get" style={{ marginTop: 16 }}>
        <div>
          <label htmlFor="market">{t("filters.market")}</label>
          <select id="market" name="market" defaultValue={country ?? ""}>
            <option value="">{t("filters.all")}</option>
            {COUNTRY_CODES.map((m) => (
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
        <p className="note" style={{ marginTop: 20 }}>
          {t("none")}
        </p>
      ) : (
        Array.from(byCountry.entries()).map(([mc, mTitles]) => (
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
                  <article className="card" key={title.id}>
                    <h3>{title.name}</h3>
                    <div className="muted">
                      {title.publisher.name} · {title.category}
                    </div>
                    {title.monthlyReach ? (
                      <div className="muted">
                        {t("reach")}:{" "}
                        {new Intl.NumberFormat().format(title.monthlyReach)}
                      </div>
                    ) : null}
                    <div className="muted">
                      {t("products")}: {title._count.products}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <span className="tag">{statusLabel}</span>
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
                      {!hasNative ? (
                        <form action={markTitleNative}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="titleId" value={title.id} />
                          <button type="submit">{t("actions.markNative")}</button>
                        </form>
                      ) : null}
                      {!declined && !hasNative ? (
                        <form action={markTitleNoNative}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="titleId" value={title.id} />
                          <button type="submit">
                            {t("actions.markNoNative")}
                          </button>
                        </form>
                      ) : null}
                      {hasNative ? (
                        <form action={deactivateTitle}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="titleId" value={title.id} />
                          <button type="submit">
                            {t("actions.deactivate")}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
