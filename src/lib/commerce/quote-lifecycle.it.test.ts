import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { submitListAsRfq, RFQ_LIST_INCLUDE } from "@/lib/commerce/submit-rfq";
import { createOrderFromQuote, QuoteNotAcceptableError } from "@/lib/commerce/accept-quote";
import { notifyQuoteAccepted, sendDraftQuotes } from "@/lib/commerce/quote-lifecycle";
import { acceptableQuoteWhere, buyerVisibleQuoteWhere } from "@/lib/commerce/quote-validity";
import { lineOrder } from "@/lib/commerce/line-order";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. Walks the desk RFQ lifecycle the way the
// server actions drive it:
//   1. the buyer's plan name survives submit (Plan.name = list name)
//   2. the desk's DRAFT quote is invisible to the buyer and can't be accepted
//   3. sending refuses an all-"on request" draft, then sends the priced one
//      once, notifying the buyer org with the real total
//   4. accepting anchors every booking to its title + publisher, keeps the
//      quote's line order, and confirms the order to the buyer org
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("quote lifecycle integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const REF = `ql-it-${Date.now()}`;
  let publisherId: string;
  let titleId: string;
  let productId: string;
  let orgId: string;
  let buyerId: string;

  before(async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const pub = await prisma.publisher.create({
      data: { name: `QL-IT publisher ${REF}`, countryCode: market.code, marketId: market.id },
    });
    publisherId = pub.id;
    const title = await prisma.title.create({
      data: {
        name: "QL-IT Title",
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
        name: "QL-IT native article",
        basePrice: 10000,
        currency: market.currency,
      },
    });
    productId = product.id;
    const org = await prisma.organization.create({
      data: { name: `QL-IT org ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO" },
    });
    orgId = org.id;
    const buyer = await prisma.user.create({
      data: { email: `${REF}@example.test`, organizationId: org.id },
    });
    buyerId = buyer.id;
  });

  after(async () => {
    await prisma.notification.deleteMany({ where: { userId: buyerId } });
  });

  // Submits a list named `listName` and leaves the request as generateQuote
  // does: one DRAFT quote, request IN_REVIEW. Line 0 is the placement (priced
  // or on request), line 1 a content fee — positions as generated.
  async function seedDraft(opts: { placementOnRequest: boolean; feeOnRequest: boolean }) {
    const created = await prisma.savedList.create({
      data: {
        organizationId: orgId,
        name: "QL-IT Autumn push",
        items: { create: [{ productId, quantity: 1, withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" }] },
      },
      select: { id: true },
    });
    const list = await prisma.savedList.findUniqueOrThrow({ where: { id: created.id }, include: RFQ_LIST_INCLUDE });
    const res = await submitListAsRfq({
      list,
      org: { id: orgId, name: `QL-IT org ${REF}` },
      brief: { text: "Brief", goal: "Leads", audience: null, budget: null, targetGeo: null, targetAudience: null, targetContext: null },
      actorUserId: null,
      locale: "no",
    });
    assert.equal(res.outcome, "submitted");
    const requestId = (res as { requestId: string }).requestId;
    const quote = await prisma.quote.create({
      data: {
        requestId,
        status: "DRAFT",
        currency: "NOK",
        subtotal: 20000,
        vatPct: 25,
        total: 25000,
        lines: {
          create: [
            {
              kind: "INVENTORY",
              productId,
              description: "QL-IT placement",
              quantity: 1,
              unitCost: 10000,
              marginPct: 50,
              lineTotal: 15000,
              priceOnRequest: opts.placementOnRequest,
              position: 0,
            },
            {
              kind: "CONTENT_FEE",
              productId: null,
              description: "QL-IT content production",
              quantity: 1,
              unitCost: 0,
              marginPct: 100,
              lineTotal: 5000,
              priceOnRequest: opts.feeOnRequest,
              position: 1,
            },
          ],
        },
      },
    });
    await prisma.request.update({ where: { id: requestId }, data: { status: "IN_REVIEW" } });
    return { requestId, quoteId: quote.id, listId: created.id };
  }

  const buyerView = (requestId: string) =>
    prisma.request.findUniqueOrThrow({
      where: { id: requestId },
      select: { plan: { select: { name: true } }, quotes: { where: buyerVisibleQuoteWhere(), select: { id: true } } },
    });

  test("the buyer's plan name becomes the request name", async () => {
    const { requestId } = await seedDraft({ placementOnRequest: false, feeOnRequest: false });
    assert.equal((await buyerView(requestId)).plan.name, "QL-IT Autumn push");
  });

  test("a DRAFT quote is invisible to the buyer and cannot be accepted", async () => {
    const { requestId, quoteId } = await seedDraft({ placementOnRequest: false, feeOnRequest: false });

    assert.equal((await buyerView(requestId)).quotes.length, 0, "request page shows no quote");
    assert.equal(
      await prisma.quote.count({ where: { id: quoteId, ...acceptableQuoteWhere() } }),
      0,
      "not on the buyer's Home 'needs you' list",
    );

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { lines: true } });
    const plan = (await prisma.request.findUniqueOrThrow({
      where: { id: requestId },
      select: { plan: { include: { items: true } } },
    })).plan;
    await assert.rejects(
      prisma.$transaction((tx) =>
        createOrderFromQuote(tx, { organizationId: orgId, quote: { id: quoteId, lines: quote.lines }, plan }),
      ),
      QuoteNotAcceptableError,
    );
    assert.equal(await prisma.order.count({ where: { quoteId } }), 0);
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    assert.equal(after.status, "DRAFT");
  });

  test("sending refuses a draft with nothing priced and tells nobody", async () => {
    const { requestId, quoteId } = await seedDraft({ placementOnRequest: true, feeOnRequest: true });
    const before = await prisma.notification.count({ where: { userId: buyerId } });

    const res = await sendDraftQuotes({
      requestId,
      validUntil: new Date(Date.now() + 7 * 86_400_000),
      actorUserId: null,
    });

    assert.deepEqual(res, { outcome: "unpriced" });
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).status, "DRAFT");
    assert.equal(await prisma.notification.count({ where: { userId: buyerId } }), before);
  });

  test("sending a priced draft makes it visible once, with the real total in the buyer's email", async () => {
    const { requestId, quoteId } = await seedDraft({ placementOnRequest: false, feeOnRequest: true });
    const validUntil = new Date("2031-10-14T23:59:59.999Z");

    const res = await sendDraftQuotes({ requestId, validUntil, actorUserId: null });
    assert.deepEqual(res, { outcome: "sent", quoteIds: [quoteId] });

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    assert.equal(quote.status, "SENT");
    assert.equal(quote.validUntil?.toISOString(), validUntil.toISOString());
    const request = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(request.status, "QUOTED");
    assert.equal((await buyerView(requestId)).quotes.length, 1, "now on the buyer's request page");

    const notes = await prisma.notification.findMany({
      where: { userId: buyerId, kind: "QUOTE_READY", link: `/no/requests/${requestId}` },
    });
    assert.equal(notes.length, 1);
    // Localized by the org's market (NO), names the plan, carries the stored
    // total and the desk's validity day — never "Total 0".
    assert.equal(notes[0].title, "Tilbudet ditt er klart: QL-IT Autumn push");
    assert.match(notes[0].body ?? "", /25\s000/u);
    assert.match(notes[0].body ?? "", /14\. oktober 2031/);
    assert.match(notes[0].body ?? "", /Én linje er prissatt på forespørsel/);

    // A second click sends nothing and notifies nobody.
    assert.deepEqual(
      await sendDraftQuotes({ requestId, validUntil, actorUserId: null }),
      { outcome: "none" },
    );
    assert.equal(
      await prisma.notification.count({ where: { userId: buyerId, kind: "QUOTE_READY", link: `/no/requests/${requestId}` } }),
      1,
    );
  });

  test("accepting anchors bookings to title + publisher, keeps line order and confirms to the buyer", async () => {
    const { requestId, quoteId } = await seedDraft({ placementOnRequest: false, feeOnRequest: false });
    await sendDraftQuotes({ requestId, validUntil: new Date(Date.now() + 7 * 86_400_000), actorUserId: null });

    // A desk reprice rewrites the placement row — physically last now. The
    // order must still read placement first.
    await prisma.quoteLine.updateMany({ where: { quoteId, kind: "INVENTORY" }, data: { lineTotal: 16000 } });

    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: quoteId },
      include: { lines: { orderBy: lineOrder() } },
    });
    const plan = (await prisma.request.findUniqueOrThrow({
      where: { id: requestId },
      select: { plan: { include: { items: true } } },
    })).plan;
    const accepted = await prisma.$transaction((tx) =>
      createOrderFromQuote(tx, { organizationId: orgId, quote: { id: quoteId, lines: quote.lines }, plan }),
    );

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: accepted.orderId },
      include: { lines: { orderBy: lineOrder(), include: { booking: true } } },
    });
    assert.deepEqual(order.lines.map((l) => l.kind), ["INVENTORY", "CONTENT_FEE"]);
    assert.deepEqual(order.lines.map((l) => l.position), [0, 1]);
    const booking = order.lines[0].booking;
    assert.ok(booking, "placement line is booked");
    assert.equal(booking.titleId, titleId);
    assert.equal(booking.publisherId, publisherId);
    assert.equal(order.lines[1].booking, null, "content fee is billing-only");

    await notifyQuoteAccepted({
      organizationId: orgId,
      orgName: `QL-IT org ${REF}`,
      marketCode: "NO",
      planName: plan.name,
      requestId,
      orders: [accepted],
      actorLocale: "no",
    });
    const confirmations = await prisma.notification.findMany({
      where: { userId: buyerId, kind: "QUOTE_ACCEPTED", link: `/no/orders/${accepted.orderId}` },
    });
    assert.equal(confirmations.length, 1, "the buyer org gets an order confirmation linking to the order");
    assert.equal(confirmations[0].title, "Bestillingen er bekreftet: QL-IT Autumn push");
  });
}
