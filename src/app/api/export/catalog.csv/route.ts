// Catalog CSV export for agency / buyer users (Maren scenario). The
// small ops-led agencies don't have engineering to build against the
// /api/v1/catalog/titles JSON contract — they want a one-click CSV
// they can pipe into Notion / Airtable / their planning spreadsheet.
//
// Auth: any signed-in user. The file is "what the catalog shows me": the
// same query params as /catalog (market, types, vertical, region, b2bB2c,
// price band, search q, …, sort), parsed by the same parseCatalogParams
// and filtered by the same buildCatalogWhere, visibility guard included.
// All pages, one file. Price is shown as a band label (e.g. "25–40k NOK") using the same
// helper as the catalog card — never the net basePrice or exact figure.

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { csv } from "@/lib/csv";
import { bandLabel } from "@/lib/pricing/bands";
import { titleBand } from "@/lib/pricing/display-price";
import { loadPricingDefaults } from "@/lib/content-fee";
import { recordAudit } from "@/lib/audit";
import { resolveCatalogSearch } from "@/lib/catalog-search";
import { refreshStaleTitlePriceBands } from "@/lib/pricing/title-band";
import { parseCatalogParams } from "@/app/[locale]/catalog/filters";
import { buildCatalogWhere, catalogOrderBy } from "@/app/[locale]/catalog/catalog-where";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const filters = parseCatalogParams(Object.fromEntries(req.nextUrl.searchParams));
  // A price-band filter reads the stored band: bring any band a recent
  // write invalidated up to date first, exactly as the catalog page does.
  if (filters.priceTiers.length) await refreshStaleTitlePriceBands();
  const search = await resolveCatalogSearch(filters.q);

  const titles = await prisma.title.findMany({
    where: buildCatalogWhere(filters, search),
    orderBy: catalogOrderBy(filters.sort),
    include: {
      publisher: { select: { name: true, pricesPublic: true } },
      market: { select: { code: true, currency: true, disclosureLabel: true } },
      products: {
        where: { active: true },
        select: {
          id: true,
          type: true,
          basePrice: true,
          pricingModel: true,
          currency: true,
          visibility: true,
          leadTimeDays: true,
          active: true,
          confirmedAt: true,
          productionFee: true,
          priceRules: {
            select: { marginPct: true, seasonalMultiplier: true, minVolume: true },
          },
        },
      },
    },
  });

  const pricing = await loadPricingDefaults();

  // One row per title; price band mirrors the catalog card (NATIVE_ARTICLE
  // preferred, else cheapest shown product). Never the exact figure.
  const rows = titles.map((t) => {
    // Same band selection as the catalog card (NATIVE_ARTICLE preferred,
    // else cheapest). Never the exact figure — and never raw basePrice.
    const fromBand = titleBand(t.products, t, pricing);
    return {
      title_id: t.id,
      slug: t.slug,
      title_name: t.name,
      publisher: t.publisher.name,
      market: t.market.code,
      currency: t.market.currency,
      category: t.category ?? "",
      monthly_reach: t.monthlyReach ?? "",
      native_fit: t.nativeFit ?? "",
      formats_available: t.products
        .map((p) => p.type)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join("|"),
      price_band: fromBand ? bandLabel(fromBand.band, fromBand.product.currency) : "",
      price_band_currency: fromBand?.product.currency ?? "",
      price_band_format: fromBand?.product.type ?? "",
      lead_time_days: fromBand?.product.leadTimeDays ?? "",
      disclosure_label: t.market.disclosureLabel ?? "",
      last_verified_at: t.lastVerifiedAt?.toISOString() ?? "",
    };
  });

  await recordAudit(session.user.id, "catalog.csv_export", `User:${session.user.id}`, {
    rows: rows.length,
    market: filters.markets.length ? filters.markets.join(",") : "ALL",
    // The query that produced the file, for "why did my export have N rows".
    query: req.nextUrl.searchParams.toString(),
  });

  const body = csv(rows);
  const today = new Date().toISOString().slice(0, 10);
  const suffix = filters.markets.length === 1 ? `-${filters.markets[0]}` : "";
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nativespin-catalog${suffix}-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
