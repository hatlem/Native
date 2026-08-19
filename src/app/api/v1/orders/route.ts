import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateRequest } from "@/lib/api-auth";
import { rfqLimiter } from "@/lib/rate-limit";
import { isProductPriceShown } from "@/lib/pricing-visibility";
import { parseOrderRequest } from "@/lib/api/order-request";
import {
  completeIdempotencyKey,
  hashRequestBody,
  isValidIdempotencyKey,
  releaseIdempotencyKey,
  reserveIdempotencyKey,
} from "@/lib/api/idempotency";
import { createFirmOrder, FirmOrderStaleError } from "@/lib/commerce/firm-order";
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
  // Captured as consts: the narrowed types don't flow into the hoisted
  // placeOrder function declaration below.
  const keyId = auth.keyId;
  const organizationId = auth.organizationId;
  const limited = await rfqLimiter.check(`api:orders:${keyId}`);
  if (!limited.ok) {
    return errJson(
      429,
      "RATE_LIMITED",
      `Retry after ${Math.ceil(limited.retryAfterMs / 1000)}s.`,
    );
  }

  // Optional Idempotency-Key: when present, a byte-identical retry of this
  // request replays the first attempt's stored response instead of minting
  // (and charging) a second order. Absent header = pre-existing behavior.
  const idemKeyHeader = req.headers.get("idempotency-key");
  if (idemKeyHeader !== null && !isValidIdempotencyKey(idemKeyHeader)) {
    return errJson(
      400,
      "BAD_IDEMPOTENCY_KEY",
      "Idempotency-Key must be 1-255 visible ASCII characters.",
    );
  }

  // Read the RAW body (not req.json()) so the idempotency request-hash is
  // byte-exact — key reuse with a different payload must be detectable.
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return errJson(400, "BAD_JSON", "Request body is not valid JSON.");
  }
  const parsed = parseOrderRequest(body);
  if (!parsed.ok) {
    return errJson(422, parsed.error.toUpperCase(), "Invalid order request.");
  }
  const items = parsed.items;
  const reference = parsed.reference;

  // Reserve the key BEFORE any catalog validation, not just before the order
  // transaction: everything past this point reads live DB state, so a retry
  // of an already-succeeded request must short-circuit to the stored replay
  // here rather than risk a fresh "product went stale" verdict that would
  // tell the client their (actually placed) order failed.
  const idem = idemKeyHeader !== null ? { apiKeyId: keyId, key: idemKeyHeader } : null;
  if (idem) {
    const reserved = await reserveIdempotencyKey({
      ...idem,
      requestHash: hashRequestBody(raw),
    });
    if (reserved.kind === "replay") {
      return NextResponse.json(reserved.responseBody, {
        status: reserved.responseStatus,
        headers: { "Idempotency-Replayed": "true" },
      });
    }
    if (reserved.kind === "in-progress") {
      return errJson(
        409,
        "IDEMPOTENCY_IN_PROGRESS",
        "A request with this Idempotency-Key is still being processed — retry shortly, or use a new key for a new order.",
      );
    }
    if (reserved.kind === "mismatch") {
      return errJson(
        422,
        "IDEMPOTENCY_KEY_REUSE",
        "This Idempotency-Key was already used with a different request body — mint a fresh key per order.",
      );
    }
  }

  // Holding a fresh reservation now: every deterministic response below is
  // stored on it before returning (so retries replay it), and an unexpected
  // throw releases it (so retries aren't wedged). If the process dies between
  // reserve and either of those, the key stays "pending" and retries get 409
  // until the client mints a new key — deliberate: a stuck 409 is strictly
  // better than a possible double charge.
  const respond = async (status: number, jsonBody: unknown): Promise<NextResponse> => {
    if (idem) {
      try {
        await completeIdempotencyKey({ ...idem, responseStatus: status, responseBody: jsonBody });
      } catch (err) {
        // Best effort: the reservation stays "pending" (retries → 409, never
        // a double charge), but this request's response is still correct.
        console.warn("api.orders.idempotency_complete_failed", { keyId, err });
      }
    }
    return NextResponse.json(jsonBody, { status });
  };
  const fail = (status: number, code: string, message: string) =>
    respond(status, { error: { code, message } });

  try {
    return await placeOrder();
  } catch (e) {
    if (idem) {
      await releaseIdempotencyKey(idem).catch((err) =>
        console.warn("api.orders.idempotency_release_failed", { keyId, err }),
      );
    }
    throw e;
  }

  async function placeOrder(): Promise<NextResponse> {
    const products = await prisma.product.findMany({
      where: {
        id: { in: items.map((i) => i.productId) },
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
    for (const it of items) {
      const p = byId.get(it.productId);
      if (!p) {
        return fail(
          422,
          "UNKNOWN_PRODUCT",
          `Product not found or not bookable: ${it.productId}`,
        );
      }
      if (p.visibility !== "FIRM" || !isProductPriceShown(p, p.title)) {
        return fail(
          422,
          "RFQ_ONLY",
          `Product ${it.productId} is not self-serve — submit an RFQ via the desk.`,
        );
      }
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    if (!org) return fail(403, "NO_ORG", "Organization not found.");

    let result: { requestId: string; orderIds: string[] };
    try {
      result = await createFirmOrder({
        organizationId: org.id,
        orgName: org.name,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
        byId,
        brief: reference ? { briefText: reference } : undefined,
      });
    } catch (e) {
      if (e instanceof FirmOrderStaleError) {
        // Deterministic business failure — store it on the reservation so a
        // retry of the same key replays this 409 instead of re-attempting.
        return fail(409, "PRODUCT_UNAVAILABLE", "A selected product is no longer available — re-check the catalog and retry.");
      }
      throw e;
    }

    // Point of no return: the order exists. Store the 201 on the reservation
    // FIRST (inside respond) so anything after — however unlikely — can only
    // lose telemetry, never cause a retry to re-charge. recordAudit is
    // best-effort by contract and never throws.
    const res = await respond(201, {
      requestId: result.requestId,
      orderIds: result.orderIds,
    });
    await recordAudit("system", "api.order.create", `Request:${result.requestId}`, {
      keyId,
      orgId: org.id,
      items,
    });
    return res;
  }
}
