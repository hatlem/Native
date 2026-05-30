import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { OrgType, MarketCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  computeQuoteLines,
  quoteTotals,
  toRateRules,
  pickContentFeeRule,
  contentFeeAmount,
} from "@/lib/money";
import { loadContentFeeRules, contentFeeLinesForGroup } from "@/lib/content-fee";
import { groupItemsByMarket } from "@/lib/quote-grouping";
import { revenueSplit } from "@/lib/reporting";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. Proves the content-fee chain end to end
// with real seeded rules: plan(withContent) -> quote line -> invoice line
// -> revenue split.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("content-fee integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const REF = "cf-it";
  let publisherId: string;
  let titleId: string;
  let productId: string;

  before(async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const pub = await prisma.publisher.create({
      data: {
        name: `CF-IT publisher ${Date.now()}`,
        countryCode: market.code,
        marketId: market.id,
      },
    });
    publisherId = pub.id;
    const title = await prisma.title.create({
      data: {
        name: "CF-IT Title",
        slug: `cf-it-${Date.now()}`,
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
        name: "CF-IT native article",
        basePrice: 10000,
        currency: market.currency,
        visibility: "FIRM",
      },
    });
    productId = product.id;
  });

  after(async () => {
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
  });

  test("withContent placement adds a CONTENT_FEE line that invoices and splits", async () => {
    const rules = await loadContentFeeRules();
    // Sanity: the seed/ops script provides a NO content-fee rule.
    const matched = pickContentFeeRule(rules, "NATIVE_ARTICLE", "NO");
    assert.ok(matched, "expected an active content-fee rule for NO/NATIVE_ARTICLE — run seed-content-fees");
    const expectedFee = Math.round(contentFeeAmount(matched));

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: { priceRules: true, title: { include: { market: true } } },
    });
    const byId = new Map([[product.id, product]]);

    const items = [{ productId, quantity: 1, withContent: true }];
    const [group] = groupItemsByMarket(items, byId);

    const lines = [
      ...computeQuoteLines([
        {
          productId,
          name: product.name,
          quantity: 1,
          basePrice: Number(product.basePrice),
          rules: toRateRules(product.priceRules),
        },
      ]),
      ...contentFeeLinesForGroup(group.items, byId, group.marketCode, rules),
    ];

    // Exactly one inventory + one content-fee line.
    const inv = lines.filter((l) => l.kind === "INVENTORY");
    const fee = lines.filter((l) => l.kind === "CONTENT_FEE");
    assert.equal(inv.length, 1);
    assert.equal(fee.length, 1);
    assert.equal(fee[0].productId, null);
    assert.equal(fee[0].lineTotal, expectedFee);

    // Persist quote + order + invoice the way the actions do.
    const { subtotal, total } = quoteTotals(lines, group.vatPct);
    const created = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: `CF-IT org ${Date.now()}`, type: OrgType.ADVERTISER, marketCode: MarketCode.NO },
      });
      const plan = await tx.plan.create({
        data: {
          organizationId: org.id,
          name: "CF-IT plan",
          currency: group.currency,
          items: { create: [{ productId, quantity: 1, withContent: true }] },
        },
      });
      const req = await tx.request.create({
        data: { organizationId: org.id, planId: plan.id, status: "CLOSED" },
        include: { organization: true },
      });
      const quote = await tx.quote.create({
        data: {
          requestId: req.id,
          status: "ACCEPTED",
          currency: group.currency,
          subtotal,
          vatPct: group.vatPct,
          total,
          lines: { create: lines },
        },
        include: { lines: true },
      });
      const order = await tx.order.create({
        data: {
          organizationId: req.organizationId,
          quoteId: quote.id,
          status: "CONFIRMED",
          lines: {
            create: quote.lines.map((l) => ({
              kind: l.kind,
              productId: l.productId,
              quantity: l.quantity,
              lineTotal: l.lineTotal,
            })),
          },
        },
      });
      const invoice = await tx.invoice.create({
        data: {
          organizationId: req.organizationId,
          orderId: order.id,
          status: "ISSUED",
          currency: quote.currency,
          subtotal: quote.subtotal,
          vatPct: quote.vatPct,
          total: quote.total,
          lines: {
            create: quote.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitAmount: l.lineTotal,
              lineTotal: l.lineTotal,
            })),
          },
        },
        include: { lines: true },
      });
      return { req, quote, order, invoice, plan };
    });

    // The content fee reached the invoice.
    const invoiceFeeLine = created.invoice.lines.find((l) =>
      l.description.startsWith("Content production"),
    );
    assert.ok(invoiceFeeLine, "content fee should appear as an invoice line");
    assert.equal(Number(invoiceFeeLine.lineTotal), expectedFee);

    // Revenue split attributes the fee to content-fee revenue.
    const split = revenueSplit(
      created.quote.lines.map((l) => ({
        kind: l.kind,
        unitCost: Number(l.unitCost),
        quantity: l.quantity,
        lineTotal: Number(l.lineTotal),
      })),
    );
    assert.equal(split.contentFeeRevenue, expectedFee);
    assert.ok(split.marginRevenue > 0, "inventory line should yield positive margin");

    // Cleanup the commerce rows created here.
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: created.invoice.id } });
    await prisma.invoice.deleteMany({ where: { id: created.invoice.id } });
    await prisma.orderLine.deleteMany({ where: { orderId: created.order.id } });
    await prisma.order.deleteMany({ where: { id: created.order.id } });
    await prisma.quoteLine.deleteMany({ where: { quoteId: created.quote.id } });
    await prisma.quote.deleteMany({ where: { id: created.quote.id } });
    await prisma.request.deleteMany({ where: { id: created.req.id } });
    await prisma.planItem.deleteMany({ where: { planId: created.plan.id } });
    await prisma.plan.deleteMany({ where: { id: created.plan.id } });
    await prisma.organization.deleteMany({ where: { id: created.req.organizationId } });
  });
}
