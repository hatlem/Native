// GET /api/v1/catalog/titles/[id] — detail view including the
// per-product spec. Same auth contract as the list endpoint.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateRequest } from "@/lib/api-auth";
import { arePricesVisible } from "@/lib/pricing-visibility";
import { rfqLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function errJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const limited = await rfqLimiter.check(`api:catalog:${auth.keyId}`);
  if (!limited.ok) {
    return errJson(429, "RATE_LIMITED", "Slow down — retry after " + Math.ceil(limited.retryAfterMs / 1000) + "s.");
  }

  const { id } = await params;
  const title = await prisma.title.findUnique({
    where: { id },
    include: {
      publisher: {
        select: {
          id: true,
          name: true,
          countryCode: true,
          pricesPublic: true,
        },
      },
      market: {
        select: {
          code: true,
          currency: true,
          disclosureLabel: true,
          vatRatePct: true,
        },
      },
      products: {
        where: { active: true },
        include: { spec: true, priceRules: true },
      },
    },
  });

  if (!title || !title.active) {
    return errJson(404, "NOT_FOUND", "Title not found or inactive.");
  }

  // When the publisher or title hides prices, redact every numeric
  // pricing field — basePriceIndicative, visibility, and the full
  // priceRules array (which encodes margin tiers we never want to
  // leak to integration partners). The shape stays stable; clients
  // gate on pricesVisible.
  const priceVisible = arePricesVisible(title);

  return NextResponse.json({
    data: {
      id: title.id,
      slug: title.slug,
      name: title.name,
      category: title.category,
      monthlyReach: title.monthlyReach,
      lastVerifiedAt: title.lastVerifiedAt,
      publisher: {
        id: title.publisher.id,
        name: title.publisher.name,
        countryCode: title.publisher.countryCode,
      },
      market: {
        ...title.market,
        vatRatePct: Number(title.market.vatRatePct),
      },
      pricesVisible: priceVisible,
      products: title.products.map((p) => ({
        id: p.id,
        type: p.type,
        basePriceIndicative: priceVisible ? Number(p.basePrice) : null,
        currency: p.currency,
        visibility: priceVisible ? p.visibility : "INDICATIVE",
        leadTimeDays: p.leadTimeDays,
        spec: p.spec
          ? {
              wordCountMin: p.spec.wordCountMin,
              wordCountMax: p.spec.wordCountMax,
              imagesMin: p.spec.imagesMin,
              disclosureLabel: p.spec.disclosureLabel,
              fileFormats: p.spec.fileFormats,
              requirements: p.spec.requirements,
            }
          : null,
        priceRules: priceVisible
          ? p.priceRules.map((r) => ({
              label: r.label,
              minVolume: r.minVolume,
              marginPct: Number(r.marginPct),
              seasonalMultiplier: Number(r.seasonalMultiplier),
            }))
          : [],
      })),
    },
  });
}
