import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MarketCode, Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import {
  markTitleNative,
  markTitleNoNative,
  deactivateTitle,
} from "@/app/title-actions";
import { createPriceRequestsBulkAction } from "@/app/price-actions";
import {
  latestConfirmedAtAcrossProducts,
  freshnessBucket,
  ageInDays,
  type FreshnessBucket,
} from "@/lib/pricing/freshness";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);
const STATUS_VALUES = ["all", "unverified", "active", "no-native"] as const;
type StatusFilter = (typeof STATUS_VALUES)[number];

const FRESHNESS_VALUES = ["never", "stale", "aging", "fresh"] as const;

function asFreshness(value: string | undefined): FreshnessBucket | undefined {
  return value && (FRESHNESS_VALUES as readonly string[]).includes(value)
    ? (value as FreshnessBucket)
    : undefined;
}

// Small fixed-domain CSV columns — perfect for dropdowns.
const NATIVE_FIT_VALUES = ["High", "Medium", "Low"] as const;
const FORMAT_VALUES = ["Print + Digital", "Digital", "Print"] as const;
const B2B_B2C_VALUES = ["B2B", "B2C"] as const;
const REACH_VALUES = ["National", "Regional", "Local", "International"] as const;
const URL_STATUS_VALUES = ["VERIFIED", "LIKELY_OK", "UNVERIFIED"] as const;

const PAGE_SIZE = 60;

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

function asEnumValue<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function str(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return typeof v === "string" ? v.trim() : "";
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

  const market = asMarket(str(sp, "market") || undefined);
  const status = asStatus(str(sp, "status") || undefined);
  const nativeFit = asEnumValue(str(sp, "nativeFit") || undefined, NATIVE_FIT_VALUES);
  const format = asEnumValue(str(sp, "format") || undefined, FORMAT_VALUES);
  const b2bB2c = asEnumValue(str(sp, "b2bB2c") || undefined, B2B_B2C_VALUES);
  const reach = asEnumValue(str(sp, "reach") || undefined, REACH_VALUES);
  const urlStatus = asEnumValue(
    str(sp, "urlStatus") || undefined,
    URL_STATUS_VALUES,
  );
  const vertical = str(sp, "vertical");
  const ownerGroup = str(sp, "ownerGroup");
  const titleType = str(sp, "type");
  const frequency = str(sp, "frequency");
  const category = str(sp, "category");
  const circulationMinRaw = str(sp, "circulationMin");
  const circulationMin =
    circulationMinRaw && /^\d+$/.test(circulationMinRaw)
      ? parseInt(circulationMinRaw, 10)
      : undefined;
  const q = str(sp, "q");
  const freshnessFilter = asFreshness(str(sp, "freshness") || undefined);
  const pageParam = parseInt(str(sp, "page") || "1", 10);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  const where: Prisma.TitleWhereInput = {
    ...(market ? { market: { code: market } } : {}),
    ...(status === "unverified" ? { lastVerifiedAt: null } : {}),
    ...(status === "active" ? { active: true } : {}),
    ...(status === "no-native"
      ? { active: false, lastVerifiedAt: { not: null } }
      : {}),
    ...(nativeFit ? { nativeFit } : {}),
    ...(format ? { format } : {}),
    ...(b2bB2c ? { b2bB2c } : {}),
    ...(reach ? { reach } : {}),
    ...(urlStatus ? { urlStatus } : {}),
    ...(vertical
      ? { vertical: { contains: vertical, mode: "insensitive" } }
      : {}),
    ...(ownerGroup
      ? { ownerGroup: { contains: ownerGroup, mode: "insensitive" } }
      : {}),
    ...(titleType
      ? { type: { contains: titleType, mode: "insensitive" } }
      : {}),
    ...(frequency
      ? { frequency: { contains: frequency, mode: "insensitive" } }
      : {}),
    ...(category
      ? { category: { contains: category, mode: "insensitive" } }
      : {}),
    ...(circulationMin !== undefined
      ? { circulation: { gte: circulationMin } }
      : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { publisherName: { contains: q, mode: "insensitive" } },
            { tags: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [filteredCount, titles] = await Promise.all([
    prisma.title.count({ where }),
    prisma.title.findMany({
      where,
      include: {
        publisher: true,
        market: true,
        _count: { select: { products: true } },
        products: { select: { confirmedAt: true } },
      },
      orderBy: [
        { market: { code: "asc" } },
        { publisher: { name: "asc" } },
        { name: "asc" },
      ],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
  ]);

  const counts = await prisma.title.groupBy({
    by: ["active"],
    _count: { _all: true },
  });
  const totalActive = counts.find((c) => c.active)?._count._all ?? 0;
  const totalInactive = counts.find((c) => !c.active)?._count._all ?? 0;
  const unverifiedCount = await prisma.title.count({
    where: { lastVerifiedAt: null },
  });

  // Compute freshness for every title, then optionally filter in-memory.
  type TitleWithFreshness = (typeof titles)[number] & {
    freshness: FreshnessBucket;
    freshnessAgeDays: number | null;
  };

  const titlesWithFreshness: TitleWithFreshness[] = titles.map((title) => {
    const latest = latestConfirmedAtAcrossProducts(title.products);
    return {
      ...title,
      freshness: freshnessBucket(latest),
      freshnessAgeDays: ageInDays(latest),
    };
  });

  const filteredTitles = freshnessFilter
    ? titlesWithFreshness.filter((t) => t.freshness === freshnessFilter)
    : titlesWithFreshness;

  const byMarket = new Map<MarketCode, TitleWithFreshness[]>();
  for (const tt of filteredTitles) {
    const arr = byMarket.get(tt.market.code) ?? [];
    arr.push(tt);
    byMarket.set(tt.market.code, arr);
  }

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  const baseParams = () => {
    const params = new URLSearchParams();
    if (market) params.set("market", market);
    if (status !== "all") params.set("status", status);
    if (nativeFit) params.set("nativeFit", nativeFit);
    if (format) params.set("format", format);
    if (b2bB2c) params.set("b2bB2c", b2bB2c);
    if (reach) params.set("reach", reach);
    if (urlStatus) params.set("urlStatus", urlStatus);
    if (vertical) params.set("vertical", vertical);
    if (ownerGroup) params.set("ownerGroup", ownerGroup);
    if (titleType) params.set("type", titleType);
    if (frequency) params.set("frequency", frequency);
    if (category) params.set("category", category);
    if (circulationMin !== undefined)
      params.set("circulationMin", String(circulationMin));
    if (q) params.set("q", q);
    return params;
  };

  const pageQuery = (p: number) => {
    const params = baseParams();
    if (freshnessFilter) params.set("freshness", freshnessFilter);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  const freshnessQuery = (bucket: FreshnessBucket | undefined) => {
    const params = baseParams();
    if (bucket) params.set("freshness", bucket);
    const s = params.toString();
    return s ? `?${s}` : "";
  };

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
        <div>
          <label htmlFor="nativeFit">{t("filters.nativeFit")}</label>
          <select id="nativeFit" name="nativeFit" defaultValue={nativeFit ?? ""}>
            <option value="">{t("filters.all")}</option>
            {NATIVE_FIT_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="format">{t("filters.format")}</label>
          <select id="format" name="format" defaultValue={format ?? ""}>
            <option value="">{t("filters.all")}</option>
            {FORMAT_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="b2bB2c">{t("filters.b2bB2c")}</label>
          <select id="b2bB2c" name="b2bB2c" defaultValue={b2bB2c ?? ""}>
            <option value="">{t("filters.all")}</option>
            {B2B_B2C_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="reach">{t("filters.reach")}</label>
          <select id="reach" name="reach" defaultValue={reach ?? ""}>
            <option value="">{t("filters.all")}</option>
            {REACH_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="urlStatus">{t("filters.urlStatus")}</label>
          <select id="urlStatus" name="urlStatus" defaultValue={urlStatus ?? ""}>
            <option value="">{t("filters.all")}</option>
            {URL_STATUS_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="vertical">{t("filters.vertical")}</label>
          <input
            id="vertical"
            name="vertical"
            defaultValue={vertical}
            placeholder={t("filters.verticalPlaceholder")}
          />
        </div>
        <div>
          <label htmlFor="ownerGroup">{t("filters.ownerGroup")}</label>
          <input
            id="ownerGroup"
            name="ownerGroup"
            defaultValue={ownerGroup}
            placeholder={t("filters.ownerGroupPlaceholder")}
          />
        </div>
        <div>
          <label htmlFor="type">{t("filters.type")}</label>
          <input
            id="type"
            name="type"
            defaultValue={titleType}
            placeholder={t("filters.typePlaceholder")}
          />
        </div>
        <div>
          <label htmlFor="frequency">{t("filters.frequency")}</label>
          <input
            id="frequency"
            name="frequency"
            defaultValue={frequency}
            placeholder={t("filters.frequencyPlaceholder")}
          />
        </div>
        <div>
          <label htmlFor="category">{t("filters.category")}</label>
          <input
            id="category"
            name="category"
            defaultValue={category}
            placeholder={t("filters.categoryPlaceholder")}
          />
        </div>
        <div>
          <label htmlFor="circulationMin">{t("filters.circulationMin")}</label>
          <input
            id="circulationMin"
            name="circulationMin"
            type="number"
            min="0"
            defaultValue={circulationMin ?? ""}
            placeholder={t("filters.circulationMinPlaceholder")}
          />
        </div>
        <div>
          <label htmlFor="q">{t("filters.search")}</label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder={t("filters.searchPlaceholder")}
          />
        </div>
        <button type="submit">{t("filters.apply")}</button>
      </form>

      <p className="muted" style={{ marginTop: 12 }}>
        {t("resultCount", { count: filteredCount })}
      </p>

      {/* Price freshness filter chips */}
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link
          href={`/desk/titles${freshnessQuery(undefined)}`}
          className={`tag${!freshnessFilter ? " active" : ""}`}
          style={!freshnessFilter ? { fontWeight: 700, opacity: 1 } : { opacity: 0.65 }}
        >
          {t("freshness.filterAll")}
        </Link>
        {FRESHNESS_VALUES.map((bucket) => (
          <Link
            key={bucket}
            href={`/desk/titles${freshnessFilter === bucket ? freshnessQuery(undefined) : freshnessQuery(bucket)}`}
            className={`tag${freshnessFilter === bucket ? " active" : ""}`}
            style={freshnessFilter === bucket ? { fontWeight: 700, opacity: 1 } : { opacity: 0.65 }}
          >
            {t(`freshness.filter${bucket.charAt(0).toUpperCase()}${bucket.slice(1)}` as `freshness.filterNever` | `freshness.filterStale` | `freshness.filterAging` | `freshness.filterFresh`)}
          </Link>
        ))}
      </div>

      {filteredTitles.length === 0 ? (
        <p className="note" style={{ marginTop: 20 }}>
          {t("none")}
        </p>
      ) : (
        <form action={createPriceRequestsBulkAction}>
          <input type="hidden" name="locale" value={locale} />
          <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit">{t("bulk.sendPriceRequest")}</button>
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
                        {new Intl.NumberFormat().format(title.circulation)}
                      </div>
                    ) : null}
                    {title.monthlyReach ? (
                      <div className="muted">
                        {t("reach")}:{" "}
                        {new Intl.NumberFormat().format(title.monthlyReach)}
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
        ))}
        </form>
      )}

      {totalPages > 1 ? (
        <nav
          className="pagination"
          style={{
            marginTop: 24,
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          {page > 1 ? (
            <a href={pageQuery(page - 1) || "?"}>← {t("pagination.prev")}</a>
          ) : (
            <span className="muted">← {t("pagination.prev")}</span>
          )}
          <span className="muted">
            {t("pagination.page", { page, total: totalPages })}
          </span>
          {page < totalPages ? (
            <a href={pageQuery(page + 1)}>{t("pagination.next")} →</a>
          ) : (
            <span className="muted">{t("pagination.next")} →</span>
          )}
        </nav>
      ) : null}
    </section>
  );
}
