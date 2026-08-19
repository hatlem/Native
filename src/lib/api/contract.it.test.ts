import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateApiToken, hashApiToken } from "@/lib/api-key";
import { POST as postOrder } from "@/app/api/v1/orders/route";
import { GET as getTitles } from "@/app/api/v1/catalog/titles/route";
import { GET as getTitle } from "@/app/api/v1/catalog/titles/[id]/route";
import { buildMcpServerForToken } from "@/lib/mcp/server";
import { readToolDefinitions } from "@/lib/mcp/tools-read";
import { mutateToolDefinitions } from "@/lib/mcp/tools-mutate";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. Exercises the public /api/v1 contract
// by invoking the route handlers directly with a NextRequest and real
// seeded ApiKey rows: auth failures, scope enforcement, body validation,
// the RFQ-only gate, the happy order path, and catalog price redaction.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

function orderReq(token: string | null, body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function titlesReq(token: string | null, qs = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v1/catalog/titles${qs}`, {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

if (!RUN_DB_IT) {
  test("api contract integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  let publisherId: string;
  let titleId: string;
  let firmProductId: string;
  let rfqProductId: string;
  let hiddenProductId: string;
  let orgId: string;
  const keyIds: string[] = [];
  let ordersToken: string;
  let noScopeToken: string;
  let noOrgToken: string;
  let revokedToken: string;
  let catalogToken: string;
  let pricingAdminToken: string;

  async function mintKey(opts: {
    scopes: string;
    organizationId?: string | null;
    revokedAt?: Date;
  }): Promise<string> {
    const raw = generateApiToken();
    const row = await prisma.apiKey.create({
      data: {
        name: `api-it ${keyIds.length}`,
        tokenHash: hashApiToken(raw),
        scopes: opts.scopes,
        organizationId: opts.organizationId ?? null,
        revokedAt: opts.revokedAt ?? null,
        createdBy: "api-it",
      },
    });
    keyIds.push(row.id);
    return raw;
  }

  before(async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const pub = await prisma.publisher.create({
      data: {
        name: `API-IT publisher ${Date.now()}`,
        countryCode: market.code,
        marketId: market.id,
      },
    });
    publisherId = pub.id;
    const title = await prisma.title.create({
      data: {
        name: "API-IT Title",
        slug: `api-it-${Date.now()}`,
        publisherId: pub.id,
        countryCode: market.code,
        marketId: market.id,
        category: "business",
        active: true,
        // Internal negotiation data — must NEVER appear in any buyer
        // surface. The canary string below is asserted absent from the
        // serialized /api/v1 responses.
        commercialExtra: {
          source: "API-IT-CANARY-CONTACT",
          netPrice: 9999,
          discountPct: 35,
        },
      },
    });
    titleId = title.id;
    // FIRM, confirmed, prices public → self-serve bookable via the API.
    const firm = await prisma.product.create({
      data: {
        titleId: title.id,
        type: "NATIVE_ARTICLE",
        name: "API-IT firm native",
        basePrice: 12000,
        currency: market.currency,
        visibility: "FIRM",
        confirmedAt: new Date(),
      },
    });
    firmProductId = firm.id;
    // Bookable but not FIRM → must be rejected with RFQ_ONLY.
    const rfq = await prisma.product.create({
      data: {
        titleId: title.id,
        type: "ADVERTORIAL",
        name: "API-IT rfq advertorial",
        basePrice: 30000,
        currency: market.currency,
        visibility: "INDICATIVE",
        confirmedAt: new Date(),
      },
    });
    rfqProductId = rfq.id;
    // Unconfirmed price → catalog must redact it.
    const hidden = await prisma.product.create({
      data: {
        titleId: title.id,
        type: "NATIVE_DISPLAY",
        name: "API-IT unconfirmed display",
        basePrice: 9000,
        currency: market.currency,
        visibility: "FIRM",
        confirmedAt: null,
      },
    });
    hiddenProductId = hidden.id;
    const org = await prisma.organization.create({
      data: { name: `API-IT org ${Date.now()}`, type: OrgType.ADVERTISER, marketCode: "NO" },
    });
    orgId = org.id;

    ordersToken = await mintKey({ scopes: "orders:write", organizationId: orgId });
    noScopeToken = await mintKey({ scopes: "catalog:read", organizationId: orgId });
    noOrgToken = await mintKey({ scopes: "orders:write" });
    revokedToken = await mintKey({
      scopes: "orders:write",
      organizationId: orgId,
      revokedAt: new Date(),
    });
    catalogToken = await mintKey({ scopes: "catalog:read" });
    pricingAdminToken = await mintKey({ scopes: "pricing:admin" });
  });

  after(async () => {
    // Orders created through the API hang off the org — walk the chain.
    await prisma.contentBrief.deleteMany({ where: { orderLine: { order: { organizationId: orgId } } } });
    await prisma.publisherBooking.deleteMany({ where: { orderLine: { order: { organizationId: orgId } } } });
    await prisma.orderLine.deleteMany({ where: { order: { organizationId: orgId } } });
    await prisma.order.deleteMany({ where: { organizationId: orgId } });
    await prisma.quoteLine.deleteMany({ where: { quote: { request: { organizationId: orgId } } } });
    await prisma.quote.deleteMany({ where: { request: { organizationId: orgId } } });
    await prisma.request.deleteMany({ where: { organizationId: orgId } });
    await prisma.planItem.deleteMany({ where: { plan: { organizationId: orgId } } });
    await prisma.plan.deleteMany({ where: { organizationId: orgId } });
    await prisma.apiKey.deleteMany({ where: { id: { in: keyIds } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.product.deleteMany({ where: { titleId } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
  });

  // ---- POST /api/v1/orders ----

  test("orders: missing bearer token → 401", async () => {
    const res = await postOrder(orderReq(null, { items: [] }));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, "MISSING");
  });

  test("orders: key without orders:write scope → 403 SCOPE", async () => {
    const res = await postOrder(
      orderReq(noScopeToken, { items: [{ productId: firmProductId, quantity: 1 }] }),
    );
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, "SCOPE");
  });

  test("orders: revoked key → 401 REVOKED", async () => {
    const res = await postOrder(
      orderReq(revokedToken, { items: [{ productId: firmProductId, quantity: 1 }] }),
    );
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, "REVOKED");
  });

  test("orders: key not bound to an organization → 403 NO_ORG", async () => {
    const res = await postOrder(
      orderReq(noOrgToken, { items: [{ productId: firmProductId, quantity: 1 }] }),
    );
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, "NO_ORG");
  });

  test("orders: malformed JSON body → 400 BAD_JSON", async () => {
    const res = await postOrder(orderReq(ordersToken, "{not json"));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, "BAD_JSON");
  });

  test("orders: empty items → 422 NO_ITEMS", async () => {
    const res = await postOrder(orderReq(ordersToken, { items: [] }));
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, "NO_ITEMS");
  });

  test("orders: unknown product → 422 UNKNOWN_PRODUCT", async () => {
    const res = await postOrder(
      orderReq(ordersToken, { items: [{ productId: "nope-123", quantity: 1 }] }),
    );
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, "UNKNOWN_PRODUCT");
  });

  test("orders: non-FIRM product → 422 RFQ_ONLY", async () => {
    const res = await postOrder(
      orderReq(ordersToken, { items: [{ productId: rfqProductId, quantity: 1 }] }),
    );
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, "RFQ_ONLY");
  });

  test("orders: FIRM basket → 201 with confirmed order", async () => {
    const res = await postOrder(
      orderReq(ordersToken, {
        items: [{ productId: firmProductId, quantity: 2 }],
        reference: "API-IT campaign",
      }),
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.requestId);
    assert.equal(body.orderIds.length, 1);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: body.orderIds[0] },
      include: { lines: true, quote: true },
    });
    assert.equal(order.status, "CONFIRMED");
    assert.equal(order.organizationId, orgId);
    assert.equal(order.quote.status, "ACCEPTED");
    assert.equal(order.lines.length, 1);
    assert.equal(order.lines[0].productId, firmProductId);
    assert.equal(order.lines[0].quantity, 2);

    const request = await prisma.request.findUniqueOrThrow({ where: { id: body.requestId } });
    assert.equal(request.status, "CLOSED");
    assert.ok(request.briefSummary?.includes("API-IT campaign"));
  });

  // ---- GET /api/v1/catalog/titles ----

  test("catalog: missing bearer token → 401", async () => {
    const res = await getTitles(titlesReq(null));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, "MISSING");
  });

  test("catalog: orders-scoped key lacks catalog:read → 403", async () => {
    // ordersToken has only orders:write.
    const res = await getTitles(titlesReq(ordersToken));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, "SCOPE");
  });

  test("catalog: lists the seeded title with stable shape and price redaction", async () => {
    // Cursor-walk the NO market until our title shows up — the dev DB
    // holds the full catalog, so a single page is not guaranteed. The
    // seeded name ("API-IT…") sorts near the top, and the page cap stays
    // under the 20/min per-key rate limit.
    let cursor: string | null = null;
    let found: {
      pricesVisible: boolean;
      products: { id: string; priceBand: string | null; visibility: string }[];
    } | null = null;
    let foundPageJson = "";
    for (let page = 0; page < 15 && !found; page++) {
      const qs = `?market=NO&limit=100${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await getTitles(titlesReq(catalogToken, qs));
      assert.equal(res.status, 200);
      const body = await res.json();
      found = body.data.find((t: { id: string }) => t.id === titleId) ?? null;
      if (found) foundPageJson = JSON.stringify(body);
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    assert.ok(found, "seeded title should appear in the NO catalog");

    // Title.commercialExtra holds internal negotiation data (net prices,
    // discount %, source contacts). The route fetches the full row via
    // `include` — guard that the explicit response mapping keeps it out.
    assert.ok(
      !foundPageJson.includes("commercialExtra"),
      "commercialExtra must never serialize into the public catalog list",
    );
    assert.ok(
      !foundPageJson.includes("API-IT-CANARY-CONTACT"),
      "commercialExtra contents must never serialize into the public catalog list",
    );

    // Confirmed products expose a band label, never a figure — and never
    // the raw net basePrice. The unconfirmed one has no band and is
    // demoted to INDICATIVE.
    assert.equal(found.pricesVisible, true);
    const firm = found.products.find((p) => p.id === firmProductId);
    const hidden = found.products.find((p) => p.id === hiddenProductId);
    assert.ok(firm && hidden);
    assert.ok(!("basePriceIndicative" in firm), "raw net cost must not leak");
    // Label shapes: "< 15k NOK" | "15–25k NOK" | "90k+ NOK".
    assert.match(firm.priceBand ?? "", /^(?:< \d+k|\d+–\d+k|\d+k\+) NOK$/);
    assert.equal(firm.visibility, "FIRM");
    assert.equal(hidden.priceBand, null);
    assert.equal(hidden.visibility, "INDICATIVE");
  });

  test("catalog: limit is clamped to [1, 100]", async () => {
    const res = await getTitles(titlesReq(catalogToken, "?limit=0"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.length <= 1);
  });

  // ---- GET /api/v1/catalog/titles/[id] ----

  test("catalog detail: commercialExtra never serializes", async () => {
    const res = await getTitle(
      new NextRequest(`http://localhost/api/v1/catalog/titles/${titleId}`, {
        method: "GET",
        headers: { authorization: `Bearer ${catalogToken}` },
      }),
      { params: Promise.resolve({ id: titleId }) },
    );
    assert.equal(res.status, 200);
    const raw = JSON.stringify(await res.json());
    assert.ok(
      !raw.includes("commercialExtra"),
      "commercialExtra must never serialize into the public title detail",
    );
    assert.ok(
      !raw.includes("API-IT-CANARY-CONTACT"),
      "commercialExtra contents must never serialize into the public title detail",
    );
    assert.ok(
      !raw.includes("basePrice"),
      "raw net basePrice must never serialize into the public title detail",
    );
  });

  // ---- MCP server gate (src/lib/mcp/server.ts) ----

  test("mcp: catalog:read key is rejected — read tools expose desk-internal data", async () => {
    // native_get_title spreads the full Title row (commercialExtra, net
    // basePrice, sales contacts). Partner keys must never open the MCP
    // surface; they get the explicit-field /api/v1 contract instead.
    const server = await buildMcpServerForToken(catalogToken);
    assert.equal(server, null);
  });

  test("mcp: pricing:admin key opens the MCP server", async () => {
    const server = await buildMcpServerForToken(pricingAdminToken);
    assert.ok(server, "desk pricing:admin key should get an MCP server");
  });

  test("mcp: native_search_titles finds a title by partial name without a known slug", async () => {
    const results = await readToolDefinitions.native_search_titles.handler({
      query: "API-IT Tit",
      limit: 20,
    });
    assert.ok(
      results.some((r) => r.id === titleId),
      "search should surface the seeded title from a partial name match",
    );
  });

  test("mcp: native_search_publishers finds a publisher by partial name", async () => {
    const results = await readToolDefinitions.native_search_publishers.handler({
      query: "API-IT publisher",
      limit: 20,
    });
    assert.ok(
      results.some((r) => r.id === publisherId),
      "search should surface the seeded publisher from a partial name match",
    );
  });

  test("mcp: native_create_title creates an inactive, unverified title under an existing publisher", async () => {
    const mutators = mutateToolDefinitions("api-it");
    const created = await mutators.native_create_title.handler({
      publisherId,
      name: "API-IT New Title",
      category: "trade-press",
    });
    assert.equal(created.active, false, "new titles must stay inactive until desk review");
    assert.equal(created.verificationStatus, "UNVERIFIED");
    assert.equal(created.publisherId, publisherId);
    assert.equal(created.marketId, (await readToolDefinitions.native_get_title.handler({ idOrSlug: titleId }))!.marketId);

    const found = await readToolDefinitions.native_search_titles.handler({
      query: "API-IT New Title",
      limit: 20,
    });
    assert.ok(found.some((r) => r.id === created.id));
  });

  test("mcp: native_create_title marks a title LIVE when verifiedFromReply is set", async () => {
    const mutators = mutateToolDefinitions("api-it");
    const created = await mutators.native_create_title.handler({
      publisherId,
      name: "API-IT Verified Title",
      category: "trade-press",
      verifiedFromReply: true,
      verificationSource: "sales-contact@example.com",
    });
    assert.equal(created.verificationStatus, "LIVE");
    assert.equal(created.verificationSource, "sales-contact@example.com");
  });
}
