// Catalog CSV export for agency / buyer users (Maren scenario). The
// small ops-led agencies don't have engineering to build against the
// /api/v1/catalog/titles JSON contract — they want a one-click CSV
// they can pipe into Notion / Airtable / their planning spreadsheet.
//
// Auth: any signed-in user. Same content visibility as the catalog
// page itself (gated catalog is the visibility unit). Indicative
// pricing follows the same per-title / per-publisher visibility logic
// as the buyer-facing card.
//
// Query params:
//   - market (NO/SE/DK/FI/DE/AT/CH/UK/IE): filter by market.
// (No format / cursor filters — this export is "give me what the
// catalog shows me" in one file. Heavy slicers can use the JSON API.)

import { NextResponse, type NextRequest } from "next/server";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { csv } from "@/lib/csv";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode) as string[];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const marketParam = url.searchParams.get("market");
  const market =
    marketParam && MARKET_CODES.includes(marketParam)
      ? (marketParam as MarketCode)
      : undefined;

  const titles = await prisma.title.findMany({
    where: {
      active: true,
      ...(market ? { market: { code: market } } : {}),
    },
    orderBy: [{ name: "asc" }],
    include: {
      publisher: { select: { name: true, pricesPublic: true } },
      market: { select: { code: true, currency: true, disclosureLabel: true } },
      products: {
        where: { active: true },
        select: {
          id: true,
          type: true,
          basePrice: true,
          currency: true,
          visibility: true,
          leadTimeDays: true,
          active: true,
          confirmedAt: true,
        },
      },
    },
  });

  // One row per title; lowest-priced indicative product (mirrors the
  // catalog-card price logic) for the headline price column.
  const rows = titles.map((t) => {
    const shownProducts = t.products.filter((p) => isProductPriceShown(p, t));
    const lowest = shownProducts
      .filter((p) => p.basePrice != null)
      .sort((a, b) => Number(a.basePrice) - Number(b.basePrice))[0];
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
      indicative_price: lowest?.basePrice != null ? String(lowest.basePrice) : "",
      indicative_price_currency: lowest?.currency ?? "",
      indicative_price_format: lowest?.type ?? "",
      lead_time_days: lowest?.leadTimeDays ?? "",
      disclosure_label: t.market.disclosureLabel ?? "",
      last_verified_at: t.lastVerifiedAt?.toISOString() ?? "",
    };
  });

  await recordAudit(session.user.id, "catalog.csv_export", `User:${session.user.id}`, {
    rows: rows.length,
    market: market ?? "ALL",
  });

  const body = csv(rows);
  const today = new Date().toISOString().slice(0, 10);
  const suffix = market ? `-${market}` : "";
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nativespin-catalog${suffix}-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
