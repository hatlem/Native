// GET /api/v1/catalog/titles/[id] — detail view including the
// per-product spec. Same auth contract as the list endpoint.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateRequest } from "@/lib/api-auth";
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
        select: { id: true, name: true, countryCode: true },
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

  return NextResponse.json({
    data: {
      id: title.id,
      slug: title.slug,
      name: title.name,
      category: title.category,
      monthlyReach: title.monthlyReach,
      lastVerifiedAt: title.lastVerifiedAt,
      publisher: title.publisher,
      market: {
        ...title.market,
        vatRatePct: Number(title.market.vatRatePct),
      },
      products: title.products.map((p) => ({
        id: p.id,
        type: p.type,
        basePriceIndicative: Number(p.basePrice),
        currency: p.currency,
        visibility: p.visibility,
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
        priceRules: p.priceRules.map((r) => ({
          label: r.label,
          minVolume: r.minVolume,
          marginPct: Number(r.marginPct),
          seasonalMultiplier: Number(r.seasonalMultiplier),
        })),
      })),
    },
  });
}
