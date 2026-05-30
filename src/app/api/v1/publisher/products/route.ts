// Publisher inventory ingestion API.
//
//   PUT /api/v1/publisher/products  — idempotent batch upsert of the
//     calling publisher's titles/products/prices/specs/availability.
//   GET /api/v1/publisher/products  — read back what's been ingested.
//
// Auth: Bearer API key with the `catalog:write` scope, bound to exactly
// one publisher (ApiKey.publisherId). A key can never read or write any
// other publisher's inventory — the publisherId comes from the key, never
// the request body. Brand-new titles land inactive until the super-admin
// activates them (the catalog curation gate).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateRequest } from "@/lib/api-auth";
import { rfqLimiter } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { parseIngestPayload } from "@/lib/ingest";
import { applyIngestion } from "@/lib/ingest-apply";

export const dynamic = "force-dynamic";

function errJson(status: number, code: string, message: string, extra?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(extra ? { details: extra } : {}) } },
    { status },
  );
}

function authErrMessage(reason: string): string {
  switch (reason) {
    case "missing":
      return "Authorization header missing or empty.";
    case "invalid":
      return "Unknown API key.";
    case "revoked":
      return "API key revoked.";
    case "expired":
      return "API key expired.";
    default:
      return "API key lacks the required scope (catalog:write).";
  }
}

// Shared auth for both verbs: valid key, write scope, bound to a publisher.
async function authorize(req: NextRequest) {
  const auth = await authenticateRequest(req, "catalog:write");
  if (!auth.ok) {
    return {
      ok: false as const,
      res: errJson(auth.status, auth.reason.toUpperCase(), authErrMessage(auth.reason)),
    };
  }
  if (!auth.publisherId) {
    return {
      ok: false as const,
      res: errJson(
        403,
        "NOT_PUBLISHER_KEY",
        "This key is not bound to a publisher and cannot use the ingestion API.",
      ),
    };
  }
  const limited = await rfqLimiter.check(`api:ingest:${auth.keyId}`);
  if (!limited.ok) {
    return {
      ok: false as const,
      res: errJson(
        429,
        "RATE_LIMITED",
        `Slow down — retry after ${Math.ceil(limited.retryAfterMs / 1000)}s.`,
      ),
    };
  }
  return { ok: true as const, keyId: auth.keyId, publisherId: auth.publisherId };
}

export async function PUT(req: NextRequest) {
  const a = await authorize(req);
  if (!a.ok) return a.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "BAD_JSON", "Request body is not valid JSON.");
  }

  const parsed = parseIngestPayload(body);
  if (!parsed.ok) {
    return errJson(422, "VALIDATION_FAILED", "Payload failed validation.", parsed.errors);
  }

  let summary;
  try {
    summary = await applyIngestion(a.publisherId, parsed.data);
  } catch (err) {
    console.error("ingest.apply_failed", { keyId: a.keyId, err });
    return errJson(500, "INGEST_FAILED", "Could not apply the ingestion.");
  }

  await recordAudit({ userId: a.keyId }, "catalog.ingest", `Publisher:${a.publisherId}`, {
    titlesCreated: summary.titlesCreated,
    titlesUpdated: summary.titlesUpdated,
    productsCreated: summary.productsCreated,
    productsUpdated: summary.productsUpdated,
    skipped: summary.skipped.length,
  });

  return NextResponse.json(
    {
      titles_created: summary.titlesCreated,
      titles_updated: summary.titlesUpdated,
      products_created: summary.productsCreated,
      products_updated: summary.productsUpdated,
      skipped: summary.skipped.map((s) => ({
        external_ref: s.externalRef,
        reason: s.reason,
      })),
      results: summary.results.map((r) => ({
        external_ref: r.externalRef,
        title_id: r.titleId,
        product_id: r.productId,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest) {
  const a = await authorize(req);
  if (!a.ok) return a.res;

  const titles = await prisma.title.findMany({
    where: { publisherId: a.publisherId, externalRef: { not: null } },
    select: {
      externalRef: true,
      name: true,
      active: true,
      countryCode: true,
      category: true,
      products: {
        where: { externalRef: { not: null } },
        select: {
          externalRef: true,
          type: true,
          name: true,
          basePrice: true,
          currency: true,
          visibility: true,
          bookable: true,
          leadTimeDays: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(
    {
      titles: titles.map((t) => ({
        external_ref: t.externalRef,
        name: t.name,
        // Inactive = awaiting NativeSpin curation before it goes public.
        active: t.active,
        market: t.countryCode,
        category: t.category,
        products: t.products.map((p) => ({
          external_ref: p.externalRef,
          type: p.type,
          name: p.name,
          base_price: Number(p.basePrice),
          currency: p.currency,
          visibility: p.visibility,
          bookable: p.bookable,
          lead_time_days: p.leadTimeDays,
        })),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
