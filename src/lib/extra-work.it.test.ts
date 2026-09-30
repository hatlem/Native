import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createOrderFromQuote } from "@/lib/commerce/accept-quote";
import { quoteFingerprint } from "@/lib/commerce/quote-offer";
import { sendDraftQuotes } from "@/lib/commerce/quote-lifecycle";
import {
  addQuoteExtraWorkLine,
  removeQuoteExtraWorkLine,
  updateQuoteLinePrice,
} from "@/lib/commerce/quote-edits";
import { addOrderExtraWork, removeOrderExtraWork } from "@/lib/commerce/order-extra-work";
import { issueInvoiceForOrder } from "@/lib/billing";
import { lineOrder } from "@/lib/commerce/line-order";
import { loadExtraWorkRates } from "@/lib/content-fee";
import { saveExtraWorkRates } from "@/lib/pricing/extra-work-rates";
import { DEFAULT_EXTRA_WORK_RATES, type ExtraWorkRateSpec } from "@/lib/pricing/extra-work";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only against
// a DISPOSABLE database. Extra work beyond an article's included scope,
// billed per hour at the currency's rate:
//   1. on a DRAFT quote: the desk's hours line moves the quote total; a SENT
//      quote refuses it (immutable), and the line can't be repriced by hand
//   2. on an ORDER: hours added after acceptance land on the invoice (lines +
//      total, with the quote's own hours line), and nothing is added or
//      removed once it is issued
//   3. the hourly rates: only SUPERADMIN may change them, audited, all or
//      nothing
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("extra work integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const REF = `ew-it-${Date.now()}`;
  const DAY = 86_400_000;
  const RATES: ExtraWorkRateSpec[] = [...DEFAULT_EXTRA_WORK_RATES];
  let publisherId = "";
  let productId = "";
  let orgId = "";
  let deskId = "";
  let superadminId = "";
  let savedRates: { currency: string; hourlyRate: unknown }[] = [];

  before(async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    publisherId = (
      await prisma.publisher.create({
        data: { name: `EW-IT publisher ${REF}`, countryCode: market.code, marketId: market.id },
      })
    ).id;
    const title = await prisma.title.create({
      data: {
        name: "EW-IT Title",
        slug: REF,
        publisherId,
        countryCode: market.code,
        marketId: market.id,
        category: "business",
        active: true,
      },
    });
    productId = (
      await prisma.product.create({
        data: { titleId: title.id, type: "ADVERTORIAL", name: "EW-IT advertorial", basePrice: 10000, currency: "NOK" },
      })
    ).id;
    orgId = (
      await prisma.organization.create({
        data: { name: `EW-IT org ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO", paymentTermsDays: 30 },
      })
    ).id;
    deskId = (await prisma.user.create({ data: { email: `${REF}-desk@example.test`, role: "DESK" } })).id;
    superadminId = (
      await prisma.user.create({ data: { email: `${REF}-sa@example.test`, role: "SUPERADMIN" } })
    ).id;
    savedRates = await prisma.extraWorkRate.findMany({ select: { currency: true, hourlyRate: true } });
  });

  after(async () => {
    const orderWhere = { order: { organizationId: orgId } };
    const quoteWhere = { request: { organizationId: orgId } };
    // Restore the rates exactly as they were before the rate test.
    await prisma.extraWorkRate.deleteMany({});
    await prisma.extraWorkRate.createMany({
      data: savedRates.map((r) => ({ currency: r.currency, hourlyRate: Number(r.hourlyRate) })),
    });
    await prisma.orderExtraWork.deleteMany({ where: orderWhere });
    await prisma.invoiceLine.deleteMany({ where: { invoice: { organizationId: orgId } } });
    await prisma.invoice.deleteMany({ where: { organizationId: orgId } });
    await prisma.publisherBooking.deleteMany({ where: { orderLine: orderWhere } });
    await prisma.contentBrief.deleteMany({ where: { orderLine: orderWhere } });
    await prisma.orderLine.deleteMany({ where: orderWhere });
    await prisma.order.deleteMany({ where: { organizationId: orgId } });
    await prisma.quoteLine.deleteMany({ where: { quote: quoteWhere } });
    await prisma.quote.deleteMany({ where: quoteWhere });
    await prisma.request.deleteMany({ where: { organizationId: orgId } });
    await prisma.planItem.deleteMany({ where: { plan: { organizationId: orgId } } });
    await prisma.plan.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { actor: { in: [deskId, superadminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [deskId, superadminId] } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.title.deleteMany({ where: { publisherId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
  });

  // A request with one DRAFT quote: a 15 000 placement and a 2 000 article
  // fee (17 000 + 25% VAT = 21 250).
  async function seedDraftQuote() {
    const plan = await prisma.plan.create({
      data: { organizationId: orgId, name: "EW-IT plan", items: { create: [{ productId, quantity: 1 }] } },
    });
    const request = await prisma.request.create({
      data: { organizationId: orgId, planId: plan.id, status: "IN_REVIEW" },
    });
    const quote = await prisma.quote.create({
      data: {
        requestId: request.id,
        status: "DRAFT",
        currency: "NOK",
        subtotal: 17000,
        vatPct: 25,
        total: 21250,
        lines: {
          create: [
            { kind: "INVENTORY", productId, description: "EW-IT advertorial", quantity: 1, unitCost: 10000, marginPct: 50, lineTotal: 15000, position: 0 },
            { kind: "CONTENT_FEE", productId: null, description: "Content production — EW-IT advertorial", quantity: 1, unitCost: 0, marginPct: 0, lineTotal: 2000, position: 1 },
          ],
        },
      },
    });
    return { requestId: request.id, planId: plan.id, quoteId: quote.id };
  }

  async function sendAndAccept(requestId: string, quoteId: string, planId: string) {
    assert.equal(
      (await sendDraftQuotes({ requestId, validUntil: new Date(Date.now() + 14 * DAY), actorUserId: deskId })).outcome,
      "sent",
    );
    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: quoteId },
      include: { lines: { orderBy: lineOrder() } },
    });
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId }, include: { items: true } });
    const { orderId } = await prisma.$transaction((tx) =>
      createOrderFromQuote(tx, {
        organizationId: orgId,
        quote: { id: quoteId, lines: quote.lines },
        offerFingerprint: quoteFingerprint(quote),
        plan,
      }),
    );
    return orderId;
  }

  test("draft quote: the desk's extra hours move the quote total; a sent quote refuses them", async () => {
    const { requestId, quoteId, planId } = await seedDraftQuote();

    const added = await addQuoteExtraWorkLine({
      requestId,
      quoteId,
      hours: 1.5,
      description: "Intervju med daglig leder",
      rates: RATES,
    });
    assert.equal(added.outcome, "added");
    if (added.outcome !== "added") return;
    assert.equal(added.hourlyRate, 1650);
    assert.equal(added.lineTotal, 2475);

    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: quoteId },
      include: { lines: { orderBy: lineOrder() } },
    });
    // 17 000 + 2 475 = 19 475, + 25% VAT = 24 343.75 → 24 344.
    assert.equal(Number(quote.subtotal), 19475);
    assert.equal(Number(quote.total), 24344);
    const line = quote.lines.at(-1)!;
    assert.equal(line.id, added.lineId);
    assert.equal(line.kind, "EXTRA_WORK");
    assert.equal(line.description, "Intervju med daglig leder");
    assert.equal(Number(line.hours), 1.5);
    assert.equal(Number(line.hourlyRate), 1650);
    assert.equal(line.position, 2, "placed after the plan's lines");

    // Priced by its hours: a hand-typed total is refused.
    assert.deepEqual(
      await updateQuoteLinePrice({
        requestId,
        quoteId,
        lineId: line.id,
        change: { intent: "set", lineTotal: 1 },
        actorUserId: deskId,
      }),
      { outcome: "not-found" },
    );

    // No rate for the currency: nothing to bill at.
    assert.deepEqual(
      await addQuoteExtraWorkLine({ requestId, quoteId, hours: 1, description: "x", rates: [] }),
      { outcome: "no-rate" },
    );

    // Remove and re-add: the totals follow both ways.
    assert.equal((await removeQuoteExtraWorkLine({ requestId, quoteId, lineId: line.id })).outcome, "removed");
    const back = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    assert.equal(Number(back.subtotal), 17000);
    assert.equal(Number(back.total), 21250);
    const again = await addQuoteExtraWorkLine({ requestId, quoteId, hours: 2, description: "Ekstra revisjonsrunde", rates: RATES });
    assert.equal(again.outcome, "added");

    // Sent: immutable. Neither a new hours line nor removing the agreed one.
    const orderId = await sendAndAccept(requestId, quoteId, planId);
    assert.deepEqual(
      await addQuoteExtraWorkLine({ requestId, quoteId, hours: 1, description: "Too late", rates: RATES }),
      { outcome: "locked" },
    );
    if (again.outcome === "added") {
      assert.deepEqual(
        await removeQuoteExtraWorkLine({ requestId, quoteId, lineId: again.lineId }),
        { outcome: "locked" },
      );
    }
    const sent = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    assert.equal(Number(sent.subtotal), 17000 + 3300);

    // The agreed hours are billing only: no fulfilment line on the order.
    const lines = await prisma.orderLine.findMany({ where: { orderId } });
    assert.deepEqual(lines.map((l) => l.kind).sort(), ["CONTENT_FEE", "INVENTORY"]);
  });

  test("order: hours added after acceptance go onto the invoice, then lock", async () => {
    const { requestId, quoteId, planId } = await seedDraftQuote();
    // One hour agreed on the quote itself…
    assert.equal(
      (await addQuoteExtraWorkLine({ requestId, quoteId, hours: 1, description: "Bildebehandling", rates: RATES })).outcome,
      "added",
    );
    const orderId = await sendAndAccept(requestId, quoteId, planId);

    // …and 2.5 more agreed after acceptance, one entry withdrawn again.
    const kept = await addOrderExtraWork({
      orderId,
      hours: 2.5,
      description: "Tredje revisjonsrunde",
      actorUserId: deskId,
      rates: RATES,
    });
    assert.equal(kept.outcome, "added");
    const dropped = await addOrderExtraWork({ orderId, hours: 1, description: "Avlyst intervju", actorUserId: deskId, rates: RATES });
    assert.equal(dropped.outcome, "added");
    if (kept.outcome !== "added" || dropped.outcome !== "added") return;
    assert.equal(kept.lineTotal, 4125);
    assert.equal(kept.currency, "NOK");
    assert.equal((await removeOrderExtraWork({ orderId, entryId: dropped.entryId })).outcome, "removed");

    await prisma.order.update({ where: { id: orderId }, data: { status: "COMPLETED" } });
    const issued = await issueInvoiceForOrder({ orderId, actorId: deskId });
    assert.equal(issued.ok, true);
    if (!issued.ok) return;

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: issued.invoiceId },
      include: { lines: { orderBy: lineOrder() } },
    });
    // Accepted 17 000 + 1 650 (quote hours) = 18 650, + 4 125 after = 22 775;
    // + 25% VAT = 28 468.75 → 28 469.
    assert.equal(Number(invoice.subtotal), 22775);
    assert.equal(Number(invoice.total), 28469);
    assert.equal(issued.total, 28469);
    assert.deepEqual(
      invoice.lines.map((l) => [l.kind, l.description, Number(l.lineTotal), l.hours === null ? null : Number(l.hours)]),
      [
        ["INVENTORY", "EW-IT advertorial", 15000, null],
        ["CONTENT_FEE", "Content production — EW-IT advertorial", 2000, null],
        ["EXTRA_WORK", "Bildebehandling", 1650, 1],
        ["EXTRA_WORK", "Tredje revisjonsrunde", 4125, 2.5],
      ],
    );
    const extra = invoice.lines.at(-1)!;
    assert.equal(extra.quantity, 1, "fractional hours never reach the integer quantity");
    assert.equal(Number(extra.unitAmount), 4125);
    assert.equal(Number(extra.hourlyRate), 1650);
    assert.equal(
      invoice.lines.reduce((s, l) => s + Number(l.lineTotal), 0),
      Number(invoice.subtotal),
      "the lines add up to the invoice subtotal",
    );

    // The entry is stamped as billed; nothing more can be added or removed.
    const entry = await prisma.orderExtraWork.findUniqueOrThrow({ where: { id: kept.entryId } });
    assert.equal(entry.invoiceId, invoice.id);
    assert.deepEqual(
      await addOrderExtraWork({ orderId, hours: 1, description: "Late", actorUserId: deskId, rates: RATES }),
      { outcome: "locked", reason: "invoiced" },
    );
    assert.deepEqual(await removeOrderExtraWork({ orderId, entryId: kept.entryId }), {
      outcome: "locked",
      reason: "invoiced",
    });
  });

  test("an order with no extra work bills exactly the accepted quote", async () => {
    const { requestId, quoteId, planId } = await seedDraftQuote();
    const orderId = await sendAndAccept(requestId, quoteId, planId);
    await prisma.order.update({ where: { id: orderId }, data: { status: "COMPLETED" } });
    const issued = await issueInvoiceForOrder({ orderId, actorId: deskId });
    assert.ok(issued.ok);
    if (!issued.ok) return;
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: issued.invoiceId } });
    assert.equal(Number(invoice.subtotal), 17000);
    assert.equal(Number(invoice.total), 21250);
  });

  test("hourly rates: SUPERADMIN only, validated as a whole, audited", async () => {
    const before = await loadExtraWorkRates();

    // A desk seat bills against the rate but may not change it.
    assert.deepEqual(
      await saveExtraWorkRates({
        actor: { userId: deskId, role: "DESK" },
        rates: [{ currency: "NOK", hourlyRate: "1" }],
      }),
      { outcome: "forbidden" },
    );
    assert.deepEqual(
      await saveExtraWorkRates({ actor: { userId: null, role: "SUPERADMIN" }, rates: [{ currency: "NOK", hourlyRate: "1" }] }),
      { outcome: "forbidden" },
    );
    // One bad value: nothing is saved.
    assert.deepEqual(
      await saveExtraWorkRates({
        actor: { userId: superadminId, role: "SUPERADMIN" },
        rates: [
          { currency: "NOK", hourlyRate: "1700" },
          { currency: "EUR", hourlyRate: "0" },
        ],
      }),
      { outcome: "invalid" },
    );
    assert.deepEqual(await loadExtraWorkRates(), before);

    const saved = await saveExtraWorkRates({
      actor: { userId: superadminId, role: "SUPERADMIN" },
      rates: [
        { currency: "NOK", hourlyRate: "1 700" },
        { currency: "EUR", hourlyRate: String(before.find((r) => r.currency === "EUR")?.hourlyRate ?? 140) },
        { currency: "usd", hourlyRate: "150" },
      ],
    });
    assert.equal(saved.outcome, "saved");
    if (saved.outcome !== "saved") return;
    // Only what changed is written and audited.
    assert.deepEqual(
      saved.changed.map((c) => c.currency).sort(),
      ["NOK", "USD"],
    );
    const after = await loadExtraWorkRates();
    assert.equal(after.find((r) => r.currency === "NOK")?.hourlyRate, 1700);
    assert.equal(after.find((r) => r.currency === "USD")?.hourlyRate, 150);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { actor: superadminId, action: "extraWorkRate.update" },
      orderBy: { createdAt: "desc" },
    });
    assert.match(audit.detail ?? "", /"currency":"NOK"/);
    assert.match(audit.detail ?? "", /"to":1700/);
  });
}
