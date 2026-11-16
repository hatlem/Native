import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createFirmOrder } from "@/lib/commerce/firm-order";
import { issueInvoiceForOrder } from "@/lib/billing";
import { deskRevenueByCurrency, type ReportOrder } from "@/lib/reporting";
import { deskRevenueByCurrencySql, orderStatusTally } from "@/lib/desk-report-sql";
import type { ReportPeriod } from "@/lib/report-period";

// DB-mutating integration test — skipped unless RUN_DB_IT=1.
// Proves the SQL aggregation behind /desk/reports gives exactly what the
// pure, unit-tested rules in lib/reporting.ts give for the same orders.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";
const REF = `rep-it-${Date.now()}`;
const ALL: ReportPeriod = { preset: "all", from: null, to: null };

// The way the page used to do it: load everything, add it up in JS.
async function viaJs(orderIds: string[]) {
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: {
      status: true,
      quote: {
        select: {
          currency: true,
          total: true,
          vatPct: true,
          lines: { select: { kind: true, unitCost: true, quantity: true, lineTotal: true, priceOnRequest: true } },
        },
      },
      extraWork: { select: { lineTotal: true } },
      creditNotes: { select: { amount: true } },
    },
  });
  const rows: ReportOrder[] = orders.map((o) => ({
    status: o.status,
    currency: o.quote.currency,
    quoteTotal: Number(o.quote.total),
    vatPct: Number(o.quote.vatPct),
    lines: o.quote.lines.map((l) => ({
      kind: l.kind,
      unitCost: Number(l.unitCost),
      quantity: l.quantity,
      lineTotal: Number(l.lineTotal),
      priceOnRequest: l.priceOnRequest,
    })),
    extraWork: o.extraWork.map((e) => Number(e.lineTotal)),
    credited: o.creditNotes.map((c) => Number(c.amount)),
  }));
  return deskRevenueByCurrency(rows);
}

test("desk report: SQL aggregation equals the pure rules", { skip: !RUN_DB_IT }, async (t) => {
  let publisherId = "";
  let titleId = "";
  let productId = "";
  let orgId = "";
  const orderIds: string[] = [];

  before(async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const pub = await prisma.publisher.create({
      data: { name: `REP-IT publisher ${REF}`, countryCode: market.code, marketId: market.id },
    });
    publisherId = pub.id;
    const title = await prisma.title.create({
      data: {
        name: "REP-IT Avisa",
        slug: REF,
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
        name: "REP-IT Avisa — NATIVE_ARTICLE",
        basePrice: 10000,
        currency: market.currency,
        visibility: "FIRM",
      },
    });
    productId = product.id;
    const org = await prisma.organization.create({
      data: { name: `REP-IT org ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO", paymentTermsDays: 30 },
    });
    orgId = org.id;
  });

  after(async () => {
    await prisma.product.deleteMany({ where: { id: productId } }).catch(() => undefined);
    await prisma.title.deleteMany({ where: { id: titleId } }).catch(() => undefined);
    await prisma.publisher.deleteMany({ where: { id: publisherId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function makeOrder(quantity: number) {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: { priceRules: true, title: { include: { market: true } } },
    });
    const { orderIds: ids } = await createFirmOrder({
      organizationId: orgId,
      orgName: "REP-IT org",
      items: [{ productId, quantity }],
      byId: new Map([[product.id, product]]),
    });
    orderIds.push(ids[0]);
    return prisma.order.findUniqueOrThrow({ where: { id: ids[0] } });
  }

  await t.test("fixture covers every rule, and both paths agree", async () => {
    // 1. Live order with a price-on-request line, a content-fee line and
    //    extra work billed after acceptance.
    const a = await makeOrder(2);
    await prisma.quoteLine.create({
      data: {
        quoteId: a.quoteId,
        productId,
        description: "unpriced",
        quantity: 1,
        unitCost: 5000,
        marginPct: 0,
        lineTotal: 5000,
        priceOnRequest: true,
      },
    });
    await prisma.quoteLine.create({
      data: {
        quoteId: a.quoteId,
        kind: "CONTENT_FEE",
        description: "article",
        quantity: 1,
        unitCost: 0,
        marginPct: 0,
        lineTotal: 3200,
      },
    });
    await prisma.orderExtraWork.create({
      data: {
        orderId: a.id,
        description: "extra hours",
        hours: 2,
        hourlyRate: 1500,
        currency: "NOK",
        lineTotal: 3000,
        createdById: "it",
      },
    });

    // 2. Cancelled order: earns nothing.
    const b = await makeOrder(1);
    await prisma.order.update({ where: { id: b.id }, data: { status: "CANCELLED" } });

    // 3. Live, invoiced, partly credited.
    const c = await makeOrder(3);
    await prisma.order.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
    const inv = await issueInvoiceForOrder({ orderId: c.id, actorId: "it" });
    assert.equal(inv.ok, true);
    if (!inv.ok) return;
    await prisma.creditNote.create({
      data: {
        invoiceId: inv.invoiceId,
        orderId: c.id,
        currency: "NOK",
        amount: 1250,
        reason: "partial",
        issuedBy: "it",
      },
    });

    // 4. A plain live order.
    await makeOrder(1);

    const js = await viaJs(orderIds);
    const sql = await deskRevenueByCurrencySql(ALL, { orderIds });
    assert.deepEqual(sql, js);

    // And the fixture really exercised the rules (not two empty results).
    assert.equal(sql.length, 1);
    const [nok] = sql;
    assert.equal(nok.currency, "NOK");
    assert.equal(nok.count, 3, "the cancelled order is left out");
    assert.equal(nok.split.contentFeeRevenue, 3200 + 3000, "content fee + extra work");
    assert.ok(nok.split.marginRevenue >= 0, "the unpriced line's cost is not a negative margin");
    assert.ok(nok.gmv > 0);
  });

  await t.test("the period bounds which orders count", async () => {
    // Move the plain order far into the past.
    const old = orderIds[orderIds.length - 1];
    await prisma.order.update({ where: { id: old }, data: { createdAt: new Date("2019-05-05T00:00:00.000Z") } });
    const recent: ReportPeriod = { preset: "custom", from: new Date("2020-01-01T00:00:00.000Z"), to: null };
    const inPast: ReportPeriod = {
      preset: "custom",
      from: new Date("2019-01-01T00:00:00.000Z"),
      to: new Date("2020-01-01T00:00:00.000Z"),
    };
    const [r] = await deskRevenueByCurrencySql(recent, { orderIds });
    assert.equal(r.count, 2);
    const [p] = await deskRevenueByCurrencySql(inPast, { orderIds });
    assert.equal(p.count, 1);
    assert.deepEqual(await deskRevenueByCurrencySql(ALL, { orderIds: [] }), []);
    // Status tally over the same window sees that one order.
    const tally = await orderStatusTally(inPast);
    assert.ok(tally.reduce((s, x) => s + x.count, 0) >= 1);
  });
});
