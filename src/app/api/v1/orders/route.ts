import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateRequest } from "@/lib/api-auth";
import { rfqLimiter } from "@/lib/rate-limit";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { parseOrderRequest } from "@/lib/api/order-request";
import { createFirmOrder } from "@/lib/commerce/firm-order";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// POST /api/v1/orders — place a firm-priced, self-serve order against named
// premium titles. Honest analogue to "programmatic buying": no auction, no
// mystery supply. The key must carry `orders:write` and be bound to the
// buying organization. RFQ-only inventory is rejected by design — those
// titles stay desk-mediated.
function errJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function authMessage(reason: string): string {
  switch (reason) {
    case "missing_token":
      return "Provide a Bearer API token.";
    case "invalid_token":
      return "API token is not valid.";
    case "revoked":
      return "API token has been revoked.";
    case "expired":
      return "API token has expired.";
    case "scope":
      return "API token lacks the orders:write scope.";
    default:
      return "Authentication failed.";
  }
}

export async function GET() {
  return errJson(405, "METHOD_NOT_ALLOWED", "Use POST to place an order.");
}

export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req, "orders:write");
  if (!auth.ok) {
    return errJson(auth.status, auth.reason.toUpperCase(), authMessage(auth.reason));
  }
  if (!auth.organizationId) {
    return errJson(403, "NO_ORG", "This key is not bound to an organization.");
  }
  const limited = await rfqLimiter.check(`api:orders:${auth.keyId}`);
  if (!limited.ok) {
    return errJson(
      429,
      "RATE_LIMITED",
      `Retry after ${Math.ceil(limited.retryAfterMs / 1000)}s.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "BAD_JSON", "Request body is not valid JSON.");
  }
  const parsed = parseOrderRequest(body);
  if (!parsed.ok) {
    return errJson(422, parsed.error.toUpperCase(), "Invalid order request.");
  }

  const products = await prisma.product.findMany({
    where: {
      id: { in: parsed.items.map((i) => i.productId) },
      active: true,
      bookable: true,
    },
    include: {
      priceRules: true,
      title: { include: { publisher: true, market: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // Every item must resolve AND be FIRM-visible. Anything else is RFQ-only
  // and must go through the desk — the API never auto-confirms a price the
  // buyer couldn't see, mirroring the /plan self-serve gate.
  for (const it of parsed.items) {
    const p = byId.get(it.productId);
    if (!p) {
      return errJson(
        422,
        "UNKNOWN_PRODUCT",
        `Product not found or not bookable: ${it.productId}`,
      );
    }
    if (p.visibility !== "FIRM" || !isProductPriceShown(p, p.title)) {
      return errJson(
        422,
        "RFQ_ONLY",
        `Product ${it.productId} is not self-serve — submit an RFQ via the desk.`,
      );
    }
  }

  const org = await prisma.organization.findUnique({
    where: { id: auth.organizationId },
    select: { id: true, name: true },
  });
  if (!org) return errJson(403, "NO_ORG", "Organization not found.");

  const result = await createFirmOrder({
    organizationId: org.id,
    orgName: org.name,
    items: parsed.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
    })),
    byId,
    brief: parsed.reference ? { briefText: parsed.reference } : undefined,
  });

  await recordAudit("system", "api.order.create", `Request:${result.requestId}`, {
    keyId: auth.keyId,
    orgId: org.id,
    items: parsed.items,
  });
  return NextResponse.json(
    { requestId: result.requestId, orderIds: result.orderIds },
    { status: 201 },
  );
}
