import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only against
// a DISPOSABLE database. Who writes the article is the buyer's choice, and we
// earn on every line we write — also where the publisher's studio could have
// written it. Driven through the REAL server actions:
//
//   1. On a publisher-capable placement a new line starts "We write it"; the
//      /plan choice switches it to "Let the publisher write it"
//      (PUBLISHER_PRODUCED) and back (NATIVESPIN_PRODUCED), never to
//      BUYER_SUPPLIED.
//   2. The instant order charges our content fee iff the line is
//      NATIVESPIN_PRODUCED, and records that authorship on the order.
//   3. The desk's generated quote does the same.
//
// Only the request scope is faked ("@/auth" returns the acting user, and
// "next/headers" a cookie jar), as in commit-idempotency.it.test.ts. Needs
// node's module mocks (--experimental-test-module-mocks, which `pnpm test:it`
// passes).
const RUN_DB_IT = process.env.RUN_DB_IT === "1";
const CAN_MOCK = typeof (mock as { module?: unknown }).module === "function";

if (!RUN_DB_IT || !CAN_MOCK) {
  test(
    "content choice integration (skipped — set RUN_DB_IT=1 and run with --experimental-test-module-mocks, as pnpm test:it does)",
    { skip: true },
    () => {},
  );
} else {
  const REF = `cc-it-${Date.now()}`;
  // The offer's own fee, so the expected figure doesn't depend on which desk
  // rules the database happens to hold.
  const OUR_FEE = 3000;
  let orgId = "";
  let buyerId = "";
  let deskId = "";
  let publisherId = "";
  let titleId = "";
  let firmStudioId = "";
  let quotedStudioId = "";

  let actingUser: { id: string; role: string; email: string } | null = null;
  const jar = new Map<string, string>();

  let checkout: typeof import("@/app/checkout-actions");
  let quotes: typeof import("@/app/quote-actions");
  let plan: typeof import("@/app/plan-actions");
  let lists: typeof import("@/lib/lists");

  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    fd.set("locale", "en");
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
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
    plan = await import("@/app/plan-actions");
    lists = await import("@/lib/lists");

    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    publisherId = (
      await prisma.publisher.create({
        data: { name: `CC-IT publisher ${REF}`, countryCode: market.code, marketId: market.id },
      })
    ).id;
    titleId = (
      await prisma.title.create({
        data: {
          name: "CC-IT Title",
          slug: REF,
          publisherId,
          countryCode: market.code,
          marketId: market.id,
          category: "business",
          active: true,
        },
      })
    ).id;
    // Both placements' articles can be written by the publisher's studio.
    const studio = {
      titleId,
      type: "NATIVE_ARTICLE" as const,
      currency: "NOK",
      confirmedAt: new Date(),
      inclusions: { production: "PUBLISHER" },
      productionFee: OUR_FEE,
    };
    // Instant-orderable: FIRM, confirmed, prices shown.
    firmStudioId = (
      await prisma.product.create({ data: { ...studio, name: "CC-IT studio (firm)", basePrice: 10000, visibility: "FIRM" } })
    ).id;
    // Desk-quoted.
    quotedStudioId = (
      await prisma.product.create({ data: { ...studio, name: "CC-IT studio (quoted)", basePrice: 20000 } })
    ).id;
    orgId = (
      await prisma.organization.create({
        data: { name: `CC-IT org ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO" },
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
    await prisma.quote.deleteMany({ where: { request: { organizationId: orgId } } });
    await prisma.request.deleteMany({ where: { organizationId: orgId } });
    await prisma.planItem.deleteMany({ where: { plan: { organizationId: orgId } } });
    await prisma.plan.deleteMany({ where: { organizationId: orgId } });
    await prisma.savedListItem.deleteMany({ where: { list: { organizationId: orgId } } });
    await prisma.savedList.deleteMany({ where: { organizationId: orgId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: [buyerId, deskId] } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.product.deleteMany({ where: { id: { in: [firmStudioId, quotedStudioId] } } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
    mock.reset();
  });

  // A one-line plan on `productId`, added the way the catalog adds it (no
  // explicit choice), then set to `choice` through the /plan action.
  async function planWith(productId: string, name: string, choice: "ours" | "publisher") {
    const list = await prisma.savedList.create({ data: { organizationId: orgId, name } });
    const item = await lists.addProductItem(list.id, productId);
    asBuyer();
    await redirectOf(
      plan.setContentProduction(form({ itemId: item.id, withContent: choice === "ours" ? "1" : "0" })),
    );
    return { listId: list.id, itemId: item.id };
  }

  const pairOf = (itemId: string) =>
    prisma.savedListItem.findUniqueOrThrow({ where: { id: itemId }, select: { withContent: true, authorshipMode: true } });

  test("a publisher-capable line starts 'We write it' and the /plan choice switches it both ways", async () => {
    const list = await prisma.savedList.create({ data: { organizationId: orgId, name: "CC-IT toggle" } });
    const item = await lists.addProductItem(list.id, firmStudioId);
    assert.deepEqual(await pairOf(item.id), { withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" });

    asBuyer();
    await redirectOf(plan.setContentProduction(form({ itemId: item.id, withContent: "0" })));
    assert.deepEqual(await pairOf(item.id), { withContent: false, authorshipMode: "PUBLISHER_PRODUCED" });
    await redirectOf(plan.setContentProduction(form({ itemId: item.id, withContent: "1" })));
    assert.deepEqual(await pairOf(item.id), { withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" });
  });

  async function instantOrder(listId: string) {
    asBuyer();
    jar.clear();
    const to = await redirectOf(checkout.submitRequest(form({ listId, briefText: "Instant order" })));
    assert.match(to, /\/requests\//, `instant order went through (${to})`);
    const [order] = await prisma.order.findMany({
      where: { quote: { request: { sourceListId: listId } } },
      include: { lines: { orderBy: { position: "asc" } }, quote: { include: { lines: true } } },
    });
    assert.ok(order, "an order was created");
    return order;
  }

  test("the instant order bills our fee on a line we write, on a publisher-capable placement", async () => {
    const { listId } = await planWith(firmStudioId, "CC-IT instant ours", "ours");
    const order = await instantOrder(listId);
    const fee = order.lines.filter((l) => l.kind === "CONTENT_FEE");
    assert.equal(fee.length, 1);
    assert.equal(Number(fee[0].lineTotal), OUR_FEE);
    const placement = order.lines.find((l) => l.kind === "INVENTORY");
    assert.equal(placement?.authorshipMode, "NATIVESPIN_PRODUCED");
    assert.equal(Number(order.quote.subtotal), 11500 + OUR_FEE);
  });

  test("the instant order bills no fee of ours when the publisher writes it", async () => {
    const { listId } = await planWith(firmStudioId, "CC-IT instant publisher", "publisher");
    const order = await instantOrder(listId);
    assert.equal(order.lines.filter((l) => l.kind === "CONTENT_FEE").length, 0);
    const placement = order.lines.find((l) => l.kind === "INVENTORY");
    assert.equal(placement?.authorshipMode, "PUBLISHER_PRODUCED");
    assert.equal(Number(order.quote.subtotal), 11500);
  });

  async function deskQuote(listId: string) {
    asBuyer();
    jar.clear();
    const to = await redirectOf(checkout.submitRequest(form({ listId, briefText: "Quote please" })));
    const request = await prisma.request.findFirstOrThrow({
      where: { sourceListId: listId },
      include: { plan: { include: { items: true } } },
    });
    assert.match(to, new RegExp(request.id), `submitted as an RFQ (${to})`);
    asDesk();
    await redirectOf(quotes.generateQuote(form({ requestId: request.id })));
    const [quote] = await prisma.quote.findMany({ where: { requestId: request.id }, include: { lines: true } });
    assert.ok(quote, "the desk generated a quote");
    return { quote, planItems: request.plan.items };
  }

  test("the desk quote carries our fee iff the line is NATIVESPIN_PRODUCED", async () => {
    const ours = await planWith(quotedStudioId, "CC-IT quote ours", "ours");
    const oursQuote = await deskQuote(ours.listId);
    assert.equal(oursQuote.planItems[0].authorshipMode, "NATIVESPIN_PRODUCED");
    const fee = oursQuote.quote.lines.filter((l) => l.kind === "CONTENT_FEE");
    assert.equal(fee.length, 1);
    assert.equal(Number(fee[0].lineTotal), OUR_FEE);

    const theirs = await planWith(quotedStudioId, "CC-IT quote publisher", "publisher");
    const theirsQuote = await deskQuote(theirs.listId);
    assert.equal(theirsQuote.planItems[0].authorshipMode, "PUBLISHER_PRODUCED");
    assert.equal(theirsQuote.quote.lines.filter((l) => l.kind === "CONTENT_FEE").length, 0);
  });
}
