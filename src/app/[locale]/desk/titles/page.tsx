import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MarketCode, Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import {
  latestConfirmedAtAcrossProducts,
  freshnessBucket,
  ageInDays,
  type FreshnessBucket,
} from "@/lib/pricing/freshness";
import {
  NATIVE_FIT_VALUES,
  FORMAT_VALUES,
  B2B_B2C_VALUES,
  REACH_VALUES,
  URL_STATUS_VALUES,
  PAGE_SIZE,
  asMarket,
  asStatus,
  asEnumValue,
  asFreshness,
  str,
} from "./filters";
import { TitlesFilterBar } from "./_components/TitlesFilterBar";
import { FreshnessChips } from "./_components/FreshnessChips";
import { TitlesGrid, type TitleWithFreshness } from "./_components/TitlesGrid";
import { TitlesPagination } from "./_components/TitlesPagination";

export const dynamic = "force-dynamic";

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

      <TitlesFilterBar
        locale={locale}
        market={market}
        status={status}
        nativeFit={nativeFit}
        format={format}
        b2bB2c={b2bB2c}
        reach={reach}
        urlStatus={urlStatus}
        vertical={vertical}
        ownerGroup={ownerGroup}
        titleType={titleType}
        frequency={frequency}
        category={category}
        circulationMin={circulationMin}
        q={q}
      />

      <p className="muted" style={{ marginTop: 12 }}>
        {t("resultCount", { count: filteredCount })}
      </p>

      <FreshnessChips
        locale={locale}
        freshnessFilter={freshnessFilter}
        freshnessQuery={freshnessQuery}
      />

      {filteredTitles.length === 0 ? (
        <p className="note" style={{ marginTop: 20 }}>
          {t("none")}
        </p>
      ) : (
        <TitlesGrid locale={locale} byMarket={byMarket} />
      )}

      <TitlesPagination
        locale={locale}
        page={page}
        totalPages={totalPages}
        pageQuery={pageQuery}
      />
    </section>
  );
}
