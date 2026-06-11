// GET /api/v1/catalog/titles — paginated public catalog listing for
// integration partners (Tobias's GroupM scenario). Auth via Bearer API
// key with the catalog:read scope.
//
// Pagination is cursor-based on Title.id (stable sort by name + id
// ascending so a partner doing a full sync doesn't miss rows when a
// new title is activated mid-sync).
//
// Query params:
//   - market (NO/SE/DK/FI/DE/AT/CH/UK/IE): filter by market
//   - limit (1..100, default 50): page size
//   - cursor: opaque pagination token returned in the previous response
//   - format (NATIVE_ARTICLE|ADVERTORIAL|NATIVE_DISPLAY|PACKAGE): only
//     return titles that have at least one active product of this type
//
// Response shape is the public contract — keep it tight and stable.
// Anything mutable (publisher commercial terms, internal margin) is
// deliberately omitted.

import { NextResponse, type NextRequest } from "next/server";
import { MarketCode, ProductType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticateRequest } from "@/lib/api-auth";
import { isProductPriceShown } from "@/lib/pricing/visibility";
import { bandLabel } from "@/lib/pricing/bands";
import { productBand } from "@/lib/pricing/display-price";
import { loadPricingDefaults } from "@/lib/content-fee";
import { rfqLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const MARKET_CODES = Object.values(MarketCode) as string[];
const PRODUCT_TYPES = Object.values(ProductType) as string[];

function errJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req, "catalog:read");
  if (!auth.ok) {
    const msg =
      auth.reason === "missing"
        ? "Authorization header missing or empty."
        : auth.reason === "invalid"
          ? "Unknown API key."
          : auth.reason === "revoked"
            ? "API key revoked."
            : auth.reason === "expired"
              ? "API key expired."
              : "API key lacks required scope.";
    return errJson(auth.status, auth.reason.toUpperCase(), msg);
  }

  // Coarse rate limit so a single key can't hammer the catalog. The
  // RFQ bucket has the right shape — partner integrations issue
  // bursts during sync, then back off.
  const limited = await rfqLimiter.check(`api:catalog:${auth.keyId}`);
  if (!limited.ok) {
    return errJson(429, "RATE_LIMITED", "Slow down — retry after " + Math.ceil(limited.retryAfterMs / 1000) + "s.");
  }

  const pricing = await loadPricingDefaults();

  const url = new URL(req.url);
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT)),
  );
  const cursor = url.searchParams.get("cursor");
  const marketParam = url.searchParams.get("market");
  const formatParam = url.searchParams.get("format");

  const market =
    marketParam && MARKET_CODES.includes(marketParam)
      ? (marketParam as MarketCode)
      : undefined;
  const format =
    formatParam && PRODUCT_TYPES.includes(formatParam)
      ? (formatParam as ProductType)
      : undefined;

  const where = {
    active: true,
    ...(market ? { market: { code: market } } : {}),
    ...(format
      ? { products: { some: { active: true, type: format } } }
      : {}),
  };

  const titles = await prisma.title.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit + 1, // peek one extra to know if there's a next page
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      publisher: {
        select: { id: true, name: true, pricesPublic: true },
      },
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
          productionFee: true,
          priceRules: {
            select: { marginPct: true, seasonalMultiplier: true, minVolume: true },
          },
        },
      },
    },
  });

  const hasMore = titles.length > limit;
  const page = hasMore ? titles.slice(0, limit) : titles;
  const nextCursor = hasMore ? page[page.length - 1]?.id : null;

  return NextResponse.json({
    data: page.map((t) => {
      // Visibility cascade per product: active + confirmedAt +
      // publisher.pricesPublic + title.pricesPublic. Visible prices are
      // published as a band label (all-in customer price bucket), never
      // a figure — and never the raw net basePrice. When hidden, the
      // band is null and visibility is demoted to INDICATIVE so
      // integration partners don't construct firm checkout flows against
      // a price the buyer never agreed to see.
      const anyPriceVisible = t.products.some((p) =>
        isProductPriceShown(p, t),
      );
      return {
        id: t.id,
        slug: t.slug,
        name: t.name,
        category: t.category,
        monthlyReach: t.monthlyReach,
        lastVerifiedAt: t.lastVerifiedAt,
        publisher: { id: t.publisher.id, name: t.publisher.name },
        market: t.market,
        pricesVisible: anyPriceVisible,
        products: t.products.map((p) => {
          // Band, never a figure — and NEVER the raw basePrice (net cost).
          const band = productBand(p, t, pricing);
          return {
            id: p.id,
            type: p.type,
            priceBand: band ? bandLabel(band, p.currency) : null,
            currency: p.currency,
            visibility: band ? p.visibility : "INDICATIVE",
            leadTimeDays: p.leadTimeDays,
          };
        }),
      };
    }),
    page: {
      limit,
      hasMore,
      nextCursor,
    },
  });
}
