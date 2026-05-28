// GET /api/v1/quotes/[id] — partner-API read-only quote lookup (v0).
//
// Scope:
//   - Returns quote status + line items + currency + totals.
//   - Auth: Bearer API key, scope `catalog:read` (re-used; we'll
//     split into `quotes:read` if/when a customer asks for a
//     per-scope-finer-grain key).
//   - Org-scoped: if the API key is org-scoped (organizationId set),
//     only quotes belonging to that org are returned. Platform keys
//     (organizationId null) see any quote — that's the same
//     visibility model the catalog read API uses.
//   - Rate-limited via the same RFQ bucket as catalog read so a
//     partner sync can't hammer the desk's working set.
//
// What's NOT here (intentionally — Phase 3 follow-up):
//   - POST /api/v1/quotes (write-side / "request a quote via API").
//   - Webhook firing on quote state transitions.
//   - Pagination of multiple quotes per request (the desk's domain
//     model has at most a small number of quote revisions per request,
//     so a list endpoint is lower-priority than write-side).
//   - Multi-option-quote audit-trail surfacing (Petter scenario).

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

  const limited = await rfqLimiter.check(`api:quotes:${auth.keyId}`);
  if (!limited.ok) {
    return errJson(
      429,
      "RATE_LIMITED",
      "Slow down — retry after " + Math.ceil(limited.retryAfterMs / 1000) + "s.",
    );
  }

  const { id } = await params;
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      request: { select: { id: true, organizationId: true } },
      lines: {
        select: {
          id: true,
          quantity: true,
          unitCost: true,
          marginPct: true,
          lineTotal: true,
          productId: true,
          description: true,
        },
      },
    },
  });

  if (!quote) return errJson(404, "NOT_FOUND", "Quote not found.");

  // Org-scoping: an org-scoped key can only see quotes for its own org.
  // Platform keys (organizationId null) see any quote.
  if (
    auth.organizationId !== null &&
    quote.request.organizationId !== auth.organizationId
  ) {
    return errJson(404, "NOT_FOUND", "Quote not found.");
  }

  return NextResponse.json({
    id: quote.id,
    request_id: quote.request.id,
    status: quote.status,
    currency: quote.currency,
    subtotal: String(quote.subtotal),
    vat_pct: String(quote.vatPct),
    total: String(quote.total),
    valid_until: quote.validUntil?.toISOString() ?? null,
    notes: quote.notes,
    lines: quote.lines.map((l) => ({
      id: l.id,
      product_id: l.productId,
      description: l.description,
      quantity: l.quantity,
      unit_cost: String(l.unitCost),
      margin_pct: String(l.marginPct),
      line_total: String(l.lineTotal),
    })),
    created_at: quote.createdAt.toISOString(),
    updated_at: quote.updatedAt.toISOString(),
  });
}
