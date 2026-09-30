import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only against
// a DISPOSABLE database. The two money commitments a buyer can make, driven
// through the REAL server actions:
//
//   1. "Accept quote" binds the buyer to the quote the page showed. A page left
//      open while the desk sent a revision used to accept the revision — a
//      price the buyer never saw (BUG-final-local-1).
//   2. The instant "Confirm order" orders a plan once. An ordered plan still
//      offered the button, and a second click booked a duplicate binding order
//      (BUG-final-local-4); a double click or a second tab must not either.
//
// Only the request scope is faked ("@/auth" returns the acting user, and
// "next/headers" a cookie jar), as in restricted-seat.it.test.ts. Needs node's
// module mocks (--experimental-test-module-mocks, which `pnpm test:it` passes).
const RUN_DB_IT = process.env.RUN_DB_IT === "1";
const CAN_MOCK = typeof (mock as { module?: unknown }).module === "function";

if (!RUN_DB_IT || !CAN_MOCK) {
  test(
    "commit idempotency integration (skipped — set RUN_DB_IT=1 and run with --experimental-test-module-mocks, as pnpm test:it does)",
    { skip: true },
    () => {},
  );
} else {
  const REF = `ci-it-${Date.now()}`;
  let orgId = "";
  let buyerId = "";
  let deskId = "";
  let publisherId = "";
  let titleId = "";
  let firmProductId = "";
  let quotedProductId = "";

  let actingUser: { id: string; role: string; email: string } | null = null;
  const jar = new Map<string, string>();

  let checkout: typeof import("@/app/checkout-actions");
  let quotes: typeof import("@/app/quote-actions");
  let deskActions: typeof import("@/app/desk-actions");
  let offer: typeof import("@/lib/commerce/quote-offer");
  let revision: typeof import("@/lib/commerce/quote-revision");
  let lifecycle: typeof import("@/lib/commerce/quote-lifecycle");
  let edits: typeof import("@/lib/commerce/quote-edits");

  const form = (fields: Record<string, string | string[]>) => {
    const fd = new FormData();
    fd.set("locale", "en");
    for (const [k, v] of Object.entries(fields)) {
      for (const value of Array.isArray(v) ? v : [v]) fd.append(k, value);
    }
    return fd;
  };

  const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
  function mockModule(specifier: string, exports: Record<string, unknown>) {
    mock.module(specifier, (NODE_MAJOR >= 26 ? { exports } : { namedExports: exports }) as never);
  }

  // A server action ends in redirect(), which throws NEXT_REDIRECT: return
  // where it sent the user.
  async function redirectOf(run: Promise<unknown>): Promise<string> {
    try {
      await run;
    } catch (err) {
      const digest = (err as { digest?: string }).digest ?? "";
      if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
      throw err;
    }
    return "(no redirect)";
  }

  const asBuyer = () => {
    actingUser = { id: buyerId, role: "BUYER", email: `${REF}-buyer@example.test` };
  };
  const asDesk = () => {
    actingUser = { id: deskId, role: "DESK", email: `${REF}-desk@example.test` };
  };

  before(async () => {
    mockModule("@/auth", {
      auth: async () =>
        actingUser ? { user: actingUser, expires: new Date(Date.now() + 3_600_000).toISOString() } : null,
    });
    mockModule("next/headers", {
      cookies: async () => ({
        get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
        set: (name: string, value: string) => void jar.set(name, value),
        delete: (name: string) => void jar.delete(name),
      }),
      headers: async () => new Headers(),
    });
    mockModule("next/cache", { revalidatePath() {}, revalidateTag() {} });
    checkout = await import("@/app/checkout-actions");
    quotes = await import("@/app/quote-actions");
    deskActions = await import("@/app/desk-actions");
    offer = await import("@/lib/commerce/quote-offer");
    revision = await import("@/lib/commerce/quote-revision");
    lifecycle = await import("@/lib/commerce/quote-lifecycle");
    edits = await import("@/lib/commerce/quote-edits");

    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    publisherId = (
      await prisma.publisher.create({
        data: { name: `CI-IT publisher ${REF}`, countryCode: market.code, marketId: market.id },
      })
    ).id;
    titleId = (
      await prisma.title.create({
        data: {
          name: "CI-IT Title",
          slug: REF,
          publisherId,
          countryCode: market.code,
          marketId: market.id,
          category: "business",
          active: true,
        },
      })
    ).id;
    // Instant-orderable: FIRM, confirmed, prices shown.
    firmProductId = (
      await prisma.product.create({
        data: {
          titleId,
          type: "NATIVE_DISPLAY",
          name: "CI-IT display",
          basePrice: 10000,
          currency: "NOK",
          visibility: "FIRM",
          confirmedAt: new Date(),
        },
      })
    ).id;
    quotedProductId = (
      await prisma.product.create({
        data: { titleId, type: "NATIVE_ARTICLE", name: "CI-IT native", basePrice: 20000, currency: "NOK", confirmedAt: new Date() },
      })
    ).id;
    orgId = (
      await prisma.organization.create({
        data: { name: `CI-IT org ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO" },
      })
    ).id;
    buyerId = (
      await prisma.user.create({
        data: { email: `${REF}-buyer@example.test`, role: "BUYER", organizationId: orgId, phone: "+4790000000" },
      })
    ).id;
    await prisma.membership.create({
      data: { userId: buyerId, organizationId: orgId, role: "ADMIN", canCommit: true, status: "ACTIVE" },
    });
    deskId = (await prisma.user.create({ data: { email: `${REF}-desk@example.test`, role: "DESK" } })).id;
  });

  after(async () => {
    const requestIds = (await prisma.request.findMany({ where: { organizationId: orgId }, select: { id: true } })).map(
      (r) => r.id,
    );
    const orderIds = (await prisma.order.findMany({ where: { organizationId: orgId }, select: { id: true } })).map(
      (o) => o.id,
    );
    await prisma.notification.deleteMany({
      where: {
        OR: [
          { userId: { in: [buyerId, deskId] } },
          ...requestIds.map((id) => ({ link: { contains: id } })),
          ...orderIds.map((id) => ({ link: { contains: id } })),
        ],
      },
    });
    await prisma.auditLog.deleteMany({ where: { actor: { in: [buyerId, deskId] } } });
    await prisma.publisherBooking.deleteMany({ where: { orderLine: { order: { organizationId: orgId } } } });
    await prisma.contentBrief.deleteMany({ where: { orderLine: { order: { organizationId: orgId } } } });
    await prisma.orderLine.deleteMany({ where: { order: { organizationId: orgId } } });
    await prisma.order.deleteMany({ where: { organizationId: orgId } });
    await prisma.quoteLine.deleteMany({ where: { quote: { request: { organizationId: orgId } } } });
    // Revisions point at their predecessors: unlink before deleting.
    await prisma.quote.updateMany({ where: { request: { organizationId: orgId } }, data: { previousQuoteId: null } });
    await prisma.quote.deleteMany({ where: { request: { organizationId: orgId } } });
    await prisma.request.deleteMany({ where: { organizationId: orgId } });
    await prisma.planItem.deleteMany({ where: { plan: { organizationId: orgId } } });
    await prisma.plan.deleteMany({ where: { organizationId: orgId } });
    await prisma.savedListItem.deleteMany({ where: { list: { organizationId: orgId } } });
    await prisma.savedList.deleteMany({ where: { organizationId: orgId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: [buyerId, deskId] } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.product.deleteMany({ where: { id: { in: [firmProductId, quotedProductId] } } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
    mock.reset();
  });

  // ---------------------------------------------------------------------------
  // 1. Accept exactly the quote the buyer saw
  // ---------------------------------------------------------------------------

  // A request with one SENT quote (revision 1), as the desk sends it.
  async function seedSentQuote() {
    const plan = await prisma.plan.create({
      data: { organizationId: orgId, name: "CI-IT quoted plan", items: { create: [{ productId: quotedProductId, quantity: 1 }] } },
    });
    const request = await prisma.request.create({ data: { organizationId: orgId, planId: plan.id, status: "QUOTED" } });
    const quote = await prisma.quote.create({
      data: {
        requestId: request.id,
        status: "SENT",
        currency: "NOK",
        subtotal: 36600,
        vatPct: 25,
        total: 45750,
        validUntil: new Date(Date.now() + 7 * 86_400_000),
        lines: {
          create: [
            {
              kind: "INVENTORY",
              productId: quotedProductId,
              description: "CI-IT native",
              quantity: 1,
              unitCost: 20000,
              marginPct: 83,
              lineTotal: 36600,
            },
          ],
        },
      },
    });
    return { requestId: request.id, quoteId: quote.id };
  }

  // The accept token(s) the request page renders for its open quotes, now.
  async function pageTokens(requestId: string): Promise<string[]> {
    const all = await prisma.quote.findMany({
      where: { requestId },
      include: { lines: true, order: { select: { id: true } } },
    });
    return all.filter(offer.isOpenOffer).map(offer.offerToken);
  }

  test("a stale 'Accept quote' for a replaced revision is refused and orders nothing", async () => {
    const { requestId, quoteId } = await seedSentQuote();
    // The buyer opens the request: the page shows revision 1.
    const stalePage = await pageTokens(requestId);
    assert.equal(stalePage.length, 1);

    // Meanwhile the desk revises the quote to another price and sends it.
    const revised = await revision.reviseQuote({ quoteId, actorUserId: deskId });
    assert.equal(revised.outcome, "created");
    const rev2Id = (revised as { quoteId: string }).quoteId;
    const rev2Line = await prisma.quoteLine.findFirstOrThrow({ where: { quoteId: rev2Id } });
    const repriced = await edits.updateQuoteLinePrice({
      requestId,
      quoteId: rev2Id,
      lineId: rev2Line.id,
      change: { intent: "set", lineTotal: 52000 },
      actorUserId: deskId,
    });
    assert.equal(repriced.outcome, "updated");
    const sent = await lifecycle.sendDraftQuotes({
      requestId,
      validUntil: new Date(Date.now() + 7 * 86_400_000),
      actorUserId: deskId,
    });
    assert.equal(sent.outcome, "sent");

    // The buyer clicks "Accept quote" on the page still showing revision 1.
    asBuyer();
    const to = await redirectOf(quotes.acceptAllQuotesForRequest(form({ requestId, offer: stalePage })));
    assert.match(to, new RegExp(`/en/requests/${requestId}\\?error=quote-replaced&revision=2$`));
    assert.equal(await prisma.order.count({ where: { quote: { requestId } } }), 0, "nothing ordered");
    const rev2 = await prisma.quote.findUniqueOrThrow({ where: { id: rev2Id } });
    assert.equal(rev2.status, "SENT", "revision 2 is still on offer, unaccepted");
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).status, "SUPERSEDED");

    // The single-quote path refuses the replaced quote the same way.
    assert.match(
      await redirectOf(quotes.acceptQuote(form({ quoteId, offer: stalePage }))),
      /error=quote-replaced&revision=2$/,
    );
    assert.equal(await prisma.order.count({ where: { quote: { requestId } } }), 0);

    // Having reviewed revision 2, the buyer accepts what the page now shows.
    const freshPage = await pageTokens(requestId);
    assert.equal(await redirectOf(quotes.acceptAllQuotesForRequest(form({ requestId, offer: freshPage }))), `/en/requests/${requestId}`);
    const order = await prisma.order.findFirstOrThrow({ where: { quote: { requestId } }, include: { quote: true } });
    assert.equal(order.quoteId, rev2Id);
    assert.equal(Number(order.quote.subtotal), 52000, "the order carries the price the buyer accepted");
  });

  test("an accept without the offer, or with a changed one, is refused and orders nothing", async () => {
    const { requestId, quoteId } = await seedSentQuote();
    asBuyer();
    // A form rendered before offer tokens existed posts only the request id.
    assert.match(await redirectOf(quotes.acceptAllQuotesForRequest(form({ requestId }))), /error=quote-changed$/);
    // A token whose fingerprint no longer matches the quote.
    assert.match(
      await redirectOf(quotes.acceptAllQuotesForRequest(form({ requestId, offer: `${quoteId}:${"0".repeat(32)}` }))),
      /error=quote-changed$/,
    );
    assert.equal(await prisma.order.count({ where: { quote: { requestId } } }), 0);
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).status, "SENT");
  });

  test("a double 'Accept quote' yields exactly one order", async () => {
    const { requestId } = await seedSentQuote();
    const page = await pageTokens(requestId);
    asBuyer();
    const [a, b] = await Promise.all([
      redirectOf(quotes.acceptAllQuotesForRequest(form({ requestId, offer: page }))),
      redirectOf(quotes.acceptAllQuotesForRequest(form({ requestId, offer: page }))),
    ]);
    assert.equal(a, `/en/requests/${requestId}`);
    assert.equal(b, `/en/requests/${requestId}`, "the loser lands on the request quietly");
    assert.equal(await prisma.order.count({ where: { quote: { requestId } } }), 1);
  });

  // ---------------------------------------------------------------------------
  // 2. An instant plan is ordered once
  // ---------------------------------------------------------------------------

  async function seedInstantPlan(name: string) {
    const list = await prisma.savedList.create({
      data: {
        organizationId: orgId,
        name,
        items: { create: [{ productId: firmProductId, quantity: 1 }] },
      },
    });
    return list.id;
  }
  const submit = (listId: string) => redirectOf(checkout.submitRequest(form({ listId, briefText: "Instant order" })));
  const listOrders = (listId: string) =>
    prisma.order.findMany({ where: { quote: { request: { sourceListId: listId } } }, orderBy: { createdAt: "asc" } });

  test("a second 'Confirm order' on an ordered plan books nothing and shows the order", async () => {
    const listId = await seedInstantPlan("CI-IT instant plan");
    asBuyer();
    jar.clear();
    const first = await submit(listId);
    const [order] = await listOrders(listId);
    assert.ok(order, "the first click ordered the plan");
    const requestId = (await prisma.request.findFirstOrThrow({ where: { sourceListId: listId } })).id;
    assert.equal(first, `/en/requests/${requestId}`);
    assert.equal(
      (await prisma.request.findUniqueOrThrow({ where: { id: requestId } })).instantOrderListId,
      listId,
      "the request holds the plan's order key",
    );

    // Later — a stale tab, or the plan reopened — the button is clicked again.
    // (Past any retry window: the old 30-second dedup let this one through.)
    await prisma.request.update({ where: { id: requestId }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    const again = await submit(listId);
    assert.equal(again, `/en/requests/${requestId}?notice=already-ordered`);
    assert.equal((await listOrders(listId)).length, 1, "still exactly one order");
    assert.equal(await prisma.request.count({ where: { sourceListId: listId } }), 1, "no second request");
  });

  test("a double click or two tabs ordering the same plan at once produce one order", async () => {
    const listId = await seedInstantPlan("CI-IT double click");
    asBuyer();
    jar.clear();
    const outcomes = await Promise.all([submit(listId), submit(listId), submit(listId)]);
    const orders = await listOrders(listId);
    assert.equal(orders.length, 1, "exactly one order");
    const requestId = (await prisma.request.findFirstOrThrow({ where: { sourceListId: listId } })).id;
    for (const to of outcomes) assert.match(to, new RegExp(`/en/requests/${requestId}(\\?notice=already-ordered)?$`));
  });

  test("the database refuses a second live instant order of the same plan", async () => {
    const listId = await seedInstantPlan("CI-IT unique key");
    asBuyer();
    jar.clear();
    await submit(listId);
    const plan = await prisma.plan.create({ data: { organizationId: orgId, name: "CI-IT bypass" } });
    await assert.rejects(
      prisma.request.create({
        data: { organizationId: orgId, planId: plan.id, status: "CLOSED", sourceListId: listId, instantOrderListId: listId },
      }),
      (err: { code?: string }) => err.code === "P2002",
    );
  });

  test("cancelling the order releases the plan, which can then be ordered again", async () => {
    const listId = await seedInstantPlan("CI-IT cancel and reorder");
    asBuyer();
    jar.clear();
    await submit(listId);
    const [order] = await listOrders(listId);

    asDesk();
    await redirectOf(deskActions.cancelOrder(form({ orderId: order.id, reason: "Booked by mistake" })));
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "CANCELLED");
    const cancelledRequest = await prisma.request.findFirstOrThrow({ where: { sourceListId: listId } });
    assert.equal(cancelledRequest.instantOrderListId, null, "nothing live: the plan is released");
    // A cancellation comes long after the order; step past checkout's
    // 10-second network-retry window, which would otherwise answer this submit.
    await prisma.request.update({
      where: { id: cancelledRequest.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });

    asBuyer();
    const again = await submit(listId);
    const orders = await listOrders(listId);
    assert.equal(orders.length, 2);
    assert.equal(orders.filter((o) => o.status !== "CANCELLED").length, 1, "one live order again");
    assert.doesNotMatch(again, /already-ordered/);
  });

  test("a plan whose desk quote was accepted is spent for the instant checkout too", async () => {
    const listId = await seedInstantPlan("CI-IT quoted then instant");
    // The plan went to the desk (a member without ordering rights sends an
    // all-firm plan as an RFQ) and its quote was accepted.
    const plan = await prisma.plan.create({ data: { organizationId: orgId, name: "CI-IT rfq snapshot" } });
    const request = await prisma.request.create({
      data: { organizationId: orgId, planId: plan.id, status: "CLOSED", sourceListId: listId },
    });
    const quote = await prisma.quote.create({
      data: { requestId: request.id, status: "ACCEPTED", currency: "NOK", subtotal: 11500, vatPct: 25, total: 14375 },
    });
    await prisma.order.create({ data: { organizationId: orgId, quoteId: quote.id, status: "CONFIRMED" } });

    asBuyer();
    jar.clear();
    assert.equal(await submit(listId), `/en/requests/${request.id}?notice=already-ordered`);
    assert.equal((await listOrders(listId)).length, 1, "no instant duplicate of the accepted order");
  });
}
