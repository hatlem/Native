// GET /api/v1/catalog/titles — paginated public catalog listing for
// integration partners (Tobias's GroupM scenario). Auth via Bearer API
// key with the catalog:read scope.
//
// Pagination is keyset-based on (name, id) — a stable sort, so a partner
// doing a full sync doesn't miss rows when a title is activated or
// deactivated mid-sync. The cursor is opaque (lib/api/catalog-query.ts).
//
// Query params (validated; anything invalid is a 400 BAD_PARAM):
//   - market (NO/SE/DK/FI/DE/AT/CH/UK/IE): filter by market
//   - limit (positive integer, default 50, clamped to 100): page size
//   - cursor: opaque pagination token returned in page.nextCursor
//   - format (a ProductType): only return titles that have at least one
//     active product of this type
//
// Response shape is the public contract, documented in
// src/app/api/openapi.json/route.ts and pinned by contract.it.test.ts —
// keep it tight and stable. Anything mutable (publisher commercial terms,
// internal margin) is deliberately omitted.

import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  describeParamErrors,
  encodeCatalogCursor,
  parseCatalogQuery,
} from "@/lib/api/catalog-query";
import { authenticateRequest } from "@/lib/api-auth";
import { isProductPriceShown } from "@/lib/pricing/visibility";
import { bandLabel } from "@/lib/pricing/bands";
import { productBand } from "@/lib/pricing/display-price";
import { loadPricingDefaults } from "@/lib/content-fee";
import { rfqLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function errJson(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
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

  const parsed = parseCatalogQuery(new URL(req.url).searchParams);
  if (!parsed.ok) {
    return errJson(400, "BAD_PARAM", describeParamErrors(parsed.errors), parsed.errors);
  }
  const { market, format, limit, cursor } = parsed.query;

  // Resume strictly after the cursor's (name, id). A legacy bare-id cursor
  // (minted before the keyset token) is resolved to its name first; an id
  // that names no title is as invalid as any other junk cursor.
  let after: { name: string; id: string } | null = null;
  if (cursor?.kind === "keyset") after = cursor;
  if (cursor?.kind === "legacy") {
    const row = await prisma.title.findUnique({
      where: { id: cursor.id },
      select: { name: true, id: true },
    });
    if (!row) {
      const errors = [{ param: "cursor", message: "does not match any page of this listing" }];
      return errJson(400, "BAD_PARAM", describeParamErrors(errors), errors);
    }
    after = row;
  }

  const pricing = await loadPricingDefaults();

  const where: Prisma.TitleWhereInput = {
    active: true,
    ...(market ? { market: { code: market } } : {}),
    ...(format
      ? { products: { some: { active: true, type: format } } }
      : {}),
    ...(after
      ? { OR: [{ name: { gt: after.name } }, { name: after.name, id: { gt: after.id } }] }
      : {}),
  };

  const titles = await prisma.title.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit + 1, // peek one extra to know if there's a next page
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

  const hasMore = titles.length > limit;
  const page = hasMore ? titles.slice(0, limit) : titles;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCatalogCursor(last.name, last.id) : null;

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
            pricingModel: p.pricingModel,
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
