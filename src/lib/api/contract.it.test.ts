import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateApiToken, hashApiToken } from "@/lib/api-key";
import { POST as postOrder } from "@/app/api/v1/orders/route";
import { GET as getTitles } from "@/app/api/v1/catalog/titles/route";
import { GET as getTitle } from "@/app/api/v1/catalog/titles/[id]/route";
import { GET as getQuote } from "@/app/api/v1/quotes/[id]/route";
import { PUT as putPublisherProducts } from "@/app/api/v1/publisher/products/route";
import { OPENAPI_SPEC } from "@/lib/api/openapi-spec";
import { conformanceErrors, responseSchema } from "@/lib/api/openapi-conformance";
import { buildMcpServerForToken } from "@/lib/mcp/server";
import { readToolDefinitions } from "@/lib/mcp/tools-read";
import { mutateToolDefinitions } from "@/lib/mcp/tools-mutate";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. Exercises the public /api/v1 contract
// by invoking the route handlers directly with a NextRequest and real
// seeded ApiKey rows: auth failures, scope enforcement, body validation,
// the RFQ-only gate, the happy order path, and catalog price redaction.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

function orderReq(
  token: string | null,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/v1/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
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
  // Own key for the catalog param/contract tests: the per-key rate limit
  // (20/min) would otherwise be shared with the tests above.
  let paramsToken: string;
  // catalog:write, bound to the test publisher (the ingestion API).
  let publisherToken: string;
  // Own key for the quote-revision reads, clear of the shared rate limit.
  let quotesToken: string;

  async function mintKey(opts: {
    scopes: string;
    organizationId?: string | null;
    publisherId?: string | null;
    revokedAt?: Date;
  }): Promise<string> {
    const raw = generateApiToken();
    const row = await prisma.apiKey.create({
      data: {
        name: `api-it ${keyIds.length}`,
        tokenHash: hashApiToken(raw),
        scopes: opts.scopes,
        organizationId: opts.organizationId ?? null,
        publisherId: opts.publisherId ?? null,
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
    paramsToken = await mintKey({ scopes: "catalog:read" });
    publisherToken = await mintKey({ scopes: "catalog:write", publisherId });
    quotesToken = await mintKey({ scopes: "catalog:read" });
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
    await prisma.product.deleteMany({ where: { title: { publisherId } } });
    // By publisherId, not just the seeded titleId: the native_create_title
    // tests mint additional titles under this publisher, and leaving them
    // FK-faults the publisher delete below (masking real failures).
    await prisma.title.deleteMany({ where: { publisherId } });
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
    // The reference names the campaign, as a plan name typed on /plan does.
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: request.planId } });
    assert.equal(plan.name, "API-IT campaign");
  });

  // ---- POST /api/v1/orders + Idempotency-Key ----

  test("orders: malformed Idempotency-Key → 400 BAD_IDEMPOTENCY_KEY", async () => {
    for (const bad of ["", "has space", "x".repeat(256), "nøkkel"]) {
      const res = await postOrder(
        orderReq(
          ordersToken,
          { items: [{ productId: firmProductId, quantity: 1 }] },
          { "idempotency-key": bad },
        ),
      );
      assert.equal(res.status, 400, `key ${JSON.stringify(bad)} should be rejected`);
      assert.equal((await res.json()).error.code, "BAD_IDEMPOTENCY_KEY");
    }
  });

  test("orders: retry with the same Idempotency-Key replays the 201 — never a second order", async () => {
    const body = {
      items: [{ productId: firmProductId, quantity: 1 }],
      reference: "API-IT idempotent",
    };
    const key = `api-it-idem-${Date.now()}`;
    const first = await postOrder(orderReq(ordersToken, body, { "idempotency-key": key }));
    assert.equal(first.status, 201);
    assert.equal(first.headers.get("idempotency-replayed"), null);
    const firstBody = await first.json();

    const ordersBefore = await prisma.order.count({ where: { organizationId: orgId } });

    // Byte-identical retry (same JSON.stringify output) → stored replay.
    const retry = await postOrder(orderReq(ordersToken, body, { "idempotency-key": key }));
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get("idempotency-replayed"), "true");
    assert.deepEqual(await retry.json(), firstBody);

    const ordersAfter = await prisma.order.count({ where: { organizationId: orgId } });
    assert.equal(ordersAfter, ordersBefore, "a replayed request must not mint another order");
  });

  test("orders: same Idempotency-Key with a different body → 422 IDEMPOTENCY_KEY_REUSE", async () => {
    const key = `api-it-reuse-${Date.now()}`;
    const first = await postOrder(
      orderReq(
        ordersToken,
        { items: [{ productId: firmProductId, quantity: 1 }] },
        { "idempotency-key": key },
      ),
    );
    assert.equal(first.status, 201);

    const res = await postOrder(
      orderReq(
        ordersToken,
        { items: [{ productId: firmProductId, quantity: 2 }] },
        { "idempotency-key": key },
      ),
    );
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, "IDEMPOTENCY_KEY_REUSE");
  });

  test("orders: deterministic failures are stored and replayed under the same key", async () => {
    const key = `api-it-fail-${Date.now()}`;
    const body = { items: [{ productId: "nope-123", quantity: 1 }] };
    const first = await postOrder(orderReq(ordersToken, body, { "idempotency-key": key }));
    assert.equal(first.status, 422);
    assert.equal((await first.json()).error.code, "UNKNOWN_PRODUCT");

    const retry = await postOrder(orderReq(ordersToken, body, { "idempotency-key": key }));
    assert.equal(retry.status, 422);
    assert.equal(retry.headers.get("idempotency-replayed"), "true");
    assert.equal((await retry.json()).error.code, "UNKNOWN_PRODUCT");
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
      // page.nextCursor — this walk read a top-level `nextCursor` (the shape
      // the old spec promised), got undefined and only ever saw page 1.
      cursor = body.page.nextCursor;
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

  test("catalog: limit above 100 is clamped and echoed in page.limit", async () => {
    const res = await getTitles(titlesReq(paramsToken, "?limit=1000"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.page.limit, 100);
    assert.ok(body.data.length <= 100);
  });

  // BUG-prod-api-23/24: `limit=abc` was a 500 with an empty body; invalid
  // filters and junk cursors silently returned unfiltered / empty pages.
  for (const [qs, param] of [
    ["?limit=abc", "limit"],
    ["?limit=-5", "limit"],
    ["?market=XX", "market"],
    ["?format=BOGUS", "format"],
    ["?cursor=doesnotexist", "cursor"],
    // Well-formed legacy id that names no title.
    ["?cursor=cm0000000000000000000000z", "cursor"],
  ] as const) {
    test(`catalog: ${qs} → 400 BAD_PARAM naming ${param}`, async () => {
      const res = await getTitles(titlesReq(paramsToken, qs));
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error.code, "BAD_PARAM");
      assert.equal(body.error.details[0].param, param);
      assert.deepEqual(
        conformanceErrors(OPENAPI_SPEC, responseSchema(OPENAPI_SPEC, "/api/v1/catalog/titles", "get", 400), body),
        [],
      );
    });
  }

  test("catalog: keyset cursor survives the cursor title being deactivated mid-sync", async () => {
    // End a page on a title that sorts just before the seeded one ("Tital" <
    // "Title"), then deactivate it — the row the cursor points at. The next
    // page must continue with the seeded title, not come back empty (which a
    // partner reads as "sync complete"; Prisma's `cursor: { id }` did that).
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const prev = await prisma.title.create({
      data: {
        name: "API-IT Tital",
        slug: `api-it-before-${Date.now()}`,
        publisherId,
        countryCode: market.code,
        marketId: market.id,
        category: "business",
        active: true,
      },
    });
    const first = await (await getTitles(titlesReq(paramsToken, "?market=NO&limit=100"))).json();
    const idx = first.data.findIndex((t: { id: string }) => t.id === prev.id);
    assert.ok(idx >= 0, "the 'before' title is on the first NO page");
    assert.equal(first.data[idx + 1]?.id, titleId, "and sorts immediately before the seeded title");
    const page = await (await getTitles(titlesReq(paramsToken, `?market=NO&limit=${idx + 1}`))).json();
    assert.equal(page.data.at(-1).id, prev.id);
    await prisma.title.update({ where: { id: prev.id }, data: { active: false } });
    const next = await (
      await getTitles(titlesReq(paramsToken, `?market=NO&limit=1&cursor=${page.page.nextCursor}`))
    ).json();
    assert.equal(next.data[0]?.id, titleId);
  });

  // BUG-prod-api-22: pin every live response to the published spec, including
  // "no undocumented fields" (openapi-conformance.ts).
  test("contract: list, detail and quote responses conform to the OpenAPI spec", async () => {
    const list = await getTitles(titlesReq(paramsToken, "?market=NO&limit=5"));
    assert.equal(list.status, 200);
    assert.deepEqual(
      conformanceErrors(OPENAPI_SPEC, responseSchema(OPENAPI_SPEC, "/api/v1/catalog/titles", "get", 200), await list.json()),
      [],
    );

    const detail = await getTitle(
      new NextRequest(`http://localhost/api/v1/catalog/titles/${titleId}`, {
        headers: { authorization: `Bearer ${paramsToken}` },
      }),
      { params: Promise.resolve({ id: titleId }) },
    );
    assert.equal(detail.status, 200);
    assert.deepEqual(
      conformanceErrors(
        OPENAPI_SPEC,
        responseSchema(OPENAPI_SPEC, "/api/v1/catalog/titles/{id}", "get", 200),
        await detail.json(),
      ),
      [],
    );

    // The FIRM order placed above produced a SENT/ACCEPTED quote for the org.
    const quote = await prisma.quote.findFirst({
      where: { request: { organizationId: orgId }, status: { not: "DRAFT" } },
      select: { id: true },
    });
    assert.ok(quote, "the order tests leave a quote behind");
    const q = await getQuote(
      new NextRequest(`http://localhost/api/v1/quotes/${quote.id}`, {
        headers: { authorization: `Bearer ${paramsToken}` },
      }),
      { params: Promise.resolve({ id: quote.id }) },
    );
    assert.equal(q.status, 200);
    assert.deepEqual(
      conformanceErrors(OPENAPI_SPEC, responseSchema(OPENAPI_SPEC, "/api/v1/quotes/{id}", "get", 200), await q.json()),
      [],
    );
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

  // ---- GET /api/v1/quotes/[id]: revisions ----

  test("quotes: a superseded quote names its revision, and both conform to the spec", async () => {
    const request = await prisma.request.findFirstOrThrow({
      where: { organizationId: orgId },
      select: { id: true },
    });
    const base = { requestId: request.id, currency: "NOK", subtotal: 1000, vatPct: 25, total: 1250 };
    const old = await prisma.quote.create({
      data: { ...base, status: "SUPERSEDED", supersededAt: new Date() },
    });
    const revision = await prisma.quote.create({
      data: { ...base, status: "SENT", revision: 2, previousQuoteId: old.id, validUntil: new Date(Date.now() + 86_400_000) },
    });
    const read = async (id: string) =>
      getQuote(
        new NextRequest(`http://localhost/api/v1/quotes/${id}`, {
          headers: { authorization: `Bearer ${quotesToken}` },
        }),
        { params: Promise.resolve({ id }) },
      );
    const schema = responseSchema(OPENAPI_SPEC, "/api/v1/quotes/{id}", "get", 200);

    const oldRes = await read(old.id);
    assert.equal(oldRes.status, 200);
    const oldBody = await oldRes.json();
    assert.equal(oldBody.status, "SUPERSEDED");
    assert.equal(oldBody.revision, 1);
    assert.equal(oldBody.superseded_by_quote_id, revision.id);
    assert.deepEqual(conformanceErrors(OPENAPI_SPEC, schema, oldBody), []);

    const newBody = await (await read(revision.id)).json();
    assert.equal(newBody.revision, 2);
    assert.equal(newBody.supersedes_quote_id, old.id);
    assert.equal(newBody.superseded_by_quote_id, null);
    assert.deepEqual(conformanceErrors(OPENAPI_SPEC, schema, newBody), []);

    await prisma.quote.delete({ where: { id: revision.id } });
    await prisma.quote.delete({ where: { id: old.id } });
  });

  test("quotes: an unsent (DRAFT) revision is never named, nor readable", async () => {
    const request = await prisma.request.findFirstOrThrow({
      where: { organizationId: orgId },
      select: { id: true },
    });
    const base = { requestId: request.id, currency: "NOK", subtotal: 1000, vatPct: 25, total: 1250 };
    const sent = await prisma.quote.create({ data: { ...base, status: "SENT" } });
    const draft = await prisma.quote.create({
      data: { ...base, status: "DRAFT", revision: 2, previousQuoteId: sent.id },
    });
    const res = await getQuote(
      new NextRequest(`http://localhost/api/v1/quotes/${sent.id}`, {
        headers: { authorization: `Bearer ${quotesToken}` },
      }),
      { params: Promise.resolve({ id: sent.id }) },
    );
    assert.equal((await res.json()).superseded_by_quote_id, null);
    const draftRes = await getQuote(
      new NextRequest(`http://localhost/api/v1/quotes/${draft.id}`, {
        headers: { authorization: `Bearer ${quotesToken}` },
      }),
      { params: Promise.resolve({ id: draft.id }) },
    );
    assert.equal(draftRes.status, 404);
    await prisma.quote.delete({ where: { id: draft.id } });
    await prisma.quote.delete({ where: { id: sent.id } });
  });

  // ---- PUT /api/v1/publisher/products: the portal rule ----

  const ingestReq = (token: string, products: unknown[]) =>
    new NextRequest("http://localhost/api/v1/publisher/products", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ products }),
    });
  const ingestProduct = (over: Record<string, unknown> = {}) => ({
    externalRef: "api-it-sku-1",
    type: "NATIVE_ARTICLE",
    name: "API-IT ingested native",
    basePrice: 18000,
    currency: "NOK",
    leadTimeDays: 10,
    title: {
      externalRef: "api-it-title-ext",
      name: "API-IT Ingested Title",
      marketCode: "NO",
      category: "business",
    },
    ...over,
  });
  const storedIngested = () =>
    prisma.product.findFirstOrThrow({
      where: { externalRef: "api-it-sku-1", title: { publisherId, externalRef: "api-it-title-ext" } },
      select: { basePrice: true, visibility: true, bookable: true, leadTimeDays: true, confirmedAt: true },
    });

  test("publisher products: a new product lands with its opening price and default desk status", async () => {
    const res = await putPublisherProducts(ingestReq(publisherToken, [ingestProduct()]));
    assert.equal(res.status, 200);
    assert.deepEqual(
      conformanceErrors(
        OPENAPI_SPEC,
        responseSchema(OPENAPI_SPEC, "/api/v1/publisher/products", "put", 200),
        await res.json(),
      ),
      [],
    );
    const p = await storedIngested();
    assert.equal(Number(p.basePrice), 18000);
    assert.equal(p.visibility, "INDICATIVE");
    assert.equal(p.bookable, true);
    assert.equal(p.confirmedAt, null, "an ingested price is unconfirmed until the desk confirms it");
  });

  test("publisher products: fields the portal allows (lead time) still update; stored values echo back fine", async () => {
    const res = await putPublisherProducts(
      ingestReq(publisherToken, [ingestProduct({ leadTimeDays: 21, visibility: "INDICATIVE", bookable: true })]),
    );
    assert.equal(res.status, 200);
    assert.equal((await storedIngested()).leadTimeDays, 21);
  });

  test("publisher products: changing price, visibility or bookable → 422 DESK_OWNED_FIELD naming the field", async () => {
    // The desk has since made it firm and repriced it — the publisher's
    // payload must not undo either.
    await prisma.product.updateMany({
      where: { externalRef: "api-it-sku-1", title: { publisherId } },
      data: { visibility: "FIRM", basePrice: 20000 },
    });
    const cases: [Record<string, unknown>, string][] = [
      [{ basePrice: 25000, visibility: "FIRM" }, "basePrice"],
      [{ basePrice: 20000, visibility: "INDICATIVE" }, "visibility"],
      [{ basePrice: 20000, bookable: false }, "bookable"],
    ];
    for (const [over, field] of cases) {
      const res = await putPublisherProducts(ingestReq(publisherToken, [ingestProduct({ ...over, leadTimeDays: 30 })]));
      assert.equal(res.status, 422, field);
      const body = await res.json();
      assert.equal(body.error.code, "DESK_OWNED_FIELD");
      assert.match(body.error.message, new RegExp(field));
      assert.deepEqual(
        body.error.details.map((d: { field: string; path: string }) => [d.field, d.path]),
        [[field, `products.0.${field}`]],
      );
      assert.deepEqual(
        conformanceErrors(
          OPENAPI_SPEC,
          responseSchema(OPENAPI_SPEC, "/api/v1/publisher/products", "put", 422),
          body,
        ),
        [],
      );
    }
    const p = await storedIngested();
    assert.equal(Number(p.basePrice), 20000, "the desk's price stands");
    assert.equal(p.visibility, "FIRM");
    assert.equal(p.bookable, true);
    assert.equal(p.leadTimeDays, 21, "a refused batch writes nothing, not even the allowed fields");
  });

  test("publisher products: a new product can't arrive instantly orderable", async () => {
    const res = await putPublisherProducts(
      ingestReq(publisherToken, [ingestProduct({ externalRef: "api-it-sku-firm", visibility: "FIRM" })]),
    );
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.details[0].field, "visibility");
    assert.equal(
      await prisma.product.count({ where: { externalRef: "api-it-sku-firm", title: { publisherId } } }),
      0,
    );
  });
}
