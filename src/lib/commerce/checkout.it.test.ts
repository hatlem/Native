import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createFirmOrder } from "@/lib/commerce/firm-order";
import { createOrderFromQuote } from "@/lib/commerce/accept-quote";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. Proves both checkout legs end to end:
//   1. self-serve: createFirmOrder mints Plan → Request(CLOSED) →
//      auto-ACCEPTED Quote → CONFIRMED Order with briefs + bookings
//   2. RFQ accept: createOrderFromQuote turns a SENT quote into a
//      CONFIRMED order, briefs/bookings on placement lines only,
//      authorship carried from the plan items
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("checkout integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const REF = "co-it";
  let publisherId: string;
  let titleId: string;
  let productId: string;
  let orgId: string;

  before(async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const pub = await prisma.publisher.create({
      data: {
        name: `CO-IT publisher ${Date.now()}`,
        countryCode: market.code,
        marketId: market.id,
      },
    });
    publisherId = pub.id;
    const title = await prisma.title.create({
      data: {
        name: "CO-IT Title",
        slug: `${REF}-${Date.now()}`,
        publisherId: pub.id,
        countryCode: market.code,
        marketId: market.id,
        category: "business",
        active: true,
      },
    });
    titleId = title.id;
    const product = await prisma.product.create({
      data: {
        titleId: title.id,
        type: "NATIVE_ARTICLE",
        name: "CO-IT native article",
        basePrice: 10000,
        currency: market.currency,
        visibility: "FIRM",
      },
    });
    productId = product.id;
    const org = await prisma.organization.create({
      data: { name: `CO-IT org ${Date.now()}`, type: OrgType.ADVERTISER, marketCode: "NO" },
    });
    orgId = org.id;
  });

  after(async () => {
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
  });

  test("createFirmOrder mints the full self-serve chain", async () => {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: { priceRules: true, title: { include: { market: true } } },
    });
    const byId = new Map([[product.id, product]]);

    const { requestId, orderIds } = await createFirmOrder({
      organizationId: orgId,
      orgName: "CO-IT org",
      items: [{ productId, quantity: 2 }],
      byId,
      brief: {
        briefText: "Launch story",
        goal: "Awareness",
        audience: "B2B buyers",
        targetGeo: "Oslo",
      },
    });

    assert.equal(orderIds.length, 1, "single-market basket → one order");

    const request = await prisma.request.findUniqueOrThrow({
      where: { id: requestId },
      include: { plan: { include: { items: true } }, quotes: true },
    });
    assert.equal(request.status, "CLOSED");
    assert.ok(request.briefSummary?.includes("Launch story"));
    assert.ok(request.briefSummary?.includes("Geo: Oslo"));
    assert.equal(request.plan.items.length, 1);
    assert.equal(request.quotes.length, 1);
    assert.equal(request.quotes[0].status, "ACCEPTED");
    assert.equal(request.quotes[0].currency, "NOK");

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderIds[0] },
      include: { lines: { include: { brief: true, booking: true } } },
    });
    assert.equal(order.status, "CONFIRMED");
    assert.equal(order.lines.length, 1);
    const line = order.lines[0];
    assert.equal(line.kind, "INVENTORY");
    assert.equal(line.productId, productId);
    assert.equal(line.quantity, 2);
    assert.equal(line.brief?.message, "Awareness");
    // Booking anchored to its publisher at creation — the campaign
    // report groups on it.
    assert.equal(line.booking?.titleId, titleId);
    assert.equal(line.booking?.publisherId, publisherId);
  });

  test("createOrderFromQuote confirms a SENT quote with briefs/bookings on placement lines only", async () => {
    // Seed an RFQ the way submitRequest + generateQuote leave it.
    const seeded = await prisma.$transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: {
          organizationId: orgId,
          name: "CO-IT RFQ plan",
          currency: "NOK",
          goal: "Leads",
          audienceNote: "CFOs",
          items: {
            create: [
              {
                productId,
                quantity: 1,
                withContent: true,
                authorshipMode: "NATIVESPIN_PRODUCED",
              },
            ],
          },
        },
        include: { items: true },
      });
      const request = await tx.request.create({
        data: { organizationId: orgId, planId: plan.id, status: "QUOTED" },
      });
      const quote = await tx.quote.create({
        data: {
          requestId: request.id,
          status: "SENT",
          currency: "NOK",
          subtotal: 15000,
          vatPct: 25,
          total: 18750,
          lines: {
            create: [
              {
                kind: "INVENTORY",
                productId,
                description: "CO-IT placement",
                quantity: 1,
                unitCost: 10000,
                marginPct: 50,
                lineTotal: 15000,
              },
              {
                kind: "CONTENT_FEE",
                productId: null,
                description: "CO-IT content production",
                quantity: 1,
                unitCost: 0,
                marginPct: 100,
                lineTotal: 5000,
              },
            ],
          },
        },
        include: { lines: true },
      });
      return { plan, request, quote };
    });

    const { orderId, productIds } = await prisma.$transaction(async (tx) => {
      const result = await createOrderFromQuote(tx, {
        organizationId: orgId,
        quote: { id: seeded.quote.id, lines: seeded.quote.lines },
        plan: seeded.plan,
      });
      await tx.request.update({
        where: { id: seeded.request.id },
        data: { status: "CLOSED" },
      });
      return result;
    });

    assert.deepEqual(productIds, [productId]);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: { include: { brief: true, booking: true } } },
    });
    assert.equal(order.status, "CONFIRMED");
    assert.equal(order.lines.length, 2);

    const inventory = order.lines.find((l) => l.kind === "INVENTORY");
    const fee = order.lines.find((l) => l.kind === "CONTENT_FEE");
    assert.ok(inventory && fee);

    // Authorship carried from the plan item; CONTENT_FEE is always ours.
    assert.equal(inventory.authorshipMode, "NATIVESPIN_PRODUCED");
    assert.equal(fee.authorshipMode, "NATIVESPIN_PRODUCED");

    // Briefs + bookings attach to placement lines only.
    assert.equal(inventory.brief?.message, "Leads");
    assert.equal(inventory.brief?.audience, "CFOs");
    assert.ok(inventory.booking, "placement line gets a booking");
    assert.equal(fee.brief, null);
    assert.equal(fee.booking, null);

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: seeded.quote.id } });
    assert.equal(quote.status, "ACCEPTED");
  });
}
