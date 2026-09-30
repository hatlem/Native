import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { offerToken } from "@/lib/commerce/quote-offer";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only against
// a DISPOSABLE database. A RESTRICTED seat is view-only (lib/scope
// canEditOnOrg): it reads its org's plans, requests and quotes but every
// mutating server action refuses it and writes nothing.
//
// Unlike the lib-level IT tests, this drives the REAL server actions. Only the
// request scope is faked: "@/auth" returns the test user's session and
// "next/headers" a cookie jar, so loadScope → getWorkspace → loadWorkspace run
// for real against the database. Needs node's module mocks
// (--experimental-test-module-mocks, which `pnpm test:it` passes).
const RUN_DB_IT = process.env.RUN_DB_IT === "1";
const CAN_MOCK = typeof (mock as { module?: unknown }).module === "function";

if (!RUN_DB_IT || !CAN_MOCK) {
  test(
    "restricted seat integration (skipped — set RUN_DB_IT=1 and run with --experimental-test-module-mocks, as pnpm test:it does)",
    { skip: true },
    () => {},
  );
} else {
  const REF = `rs-it-${Date.now()}`;
  let orgId = "";
  let viewerId = "";
  let memberId = "";
  let productId = "";
  let titleId = "";
  let publisherId = "";
  let listId = "";
  let itemId = "";
  let requestId = "";
  let quoteId = "";

  // The acting user for the next action call; the fake "@/auth" reads it.
  let actingUser: { id: string; role: string; email: string } | null = null;
  const jar = new Map<string, string>();

  // Loaded after the mocks are in place (see before()).
  let lists: typeof import("@/app/list-actions");
  let checkout: typeof import("@/app/checkout-actions");
  let quotes: typeof import("@/app/quote-actions");
  let campaign: typeof import("@/app/campaign-actions");
  let articles: typeof import("@/app/article-library-actions");
  let programmes: typeof import("@/app/programme-actions");
  let review: typeof import("@/app/content-review-actions");
  let desk: typeof import("@/app/desk-content-actions");

  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    fd.set("locale", "en");
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  // mock.module's option was renamed: `namedExports` (Node 22, CI) became
  // `exports` (and the old name deprecated, then refused alongside it). Use
  // whichever this Node understands.
  const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
  function mockModule(specifier: string, exports: Record<string, unknown>) {
    mock.module(specifier, (NODE_MAJOR >= 26 ? { exports } : { namedExports: exports }) as never);
  }

  // A server action ends in redirect(), which throws NEXT_REDIRECT. The
  // refusal is what matters here; return where it sent the user.
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
    lists = await import("@/app/list-actions");
    checkout = await import("@/app/checkout-actions");
    quotes = await import("@/app/quote-actions");
    campaign = await import("@/app/campaign-actions");
    articles = await import("@/app/article-library-actions");
    programmes = await import("@/app/programme-actions");
    review = await import("@/app/content-review-actions");
    desk = await import("@/app/desk-content-actions");

    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    publisherId = (
      await prisma.publisher.create({
        data: { name: `RS-IT publisher ${REF}`, countryCode: market.code, marketId: market.id },
      })
    ).id;
    titleId = (
      await prisma.title.create({
        data: {
          name: "RS-IT Title",
          slug: REF,
          publisherId,
          countryCode: market.code,
          marketId: market.id,
          category: "business",
          active: true,
        },
      })
    ).id;
    productId = (
      await prisma.product.create({
        data: { titleId, type: "NATIVE_ARTICLE", name: "RS-IT native", basePrice: 10000, currency: "NOK", confirmedAt: new Date() },
      })
    ).id;
    orgId = (
      await prisma.organization.create({
        data: { name: `RS-IT org ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO", legalName: "Original AS" },
      })
    ).id;
    viewerId = (
      await prisma.user.create({ data: { email: `${REF}-viewer@example.test`, role: "BUYER", organizationId: orgId } })
    ).id;
    memberId = (
      await prisma.user.create({ data: { email: `${REF}-member@example.test`, role: "BUYER", organizationId: orgId } })
    ).id;
    await prisma.membership.createMany({
      data: [
        { userId: viewerId, organizationId: orgId, role: "RESTRICTED", canCommit: false, status: "ACTIVE" },
        { userId: memberId, organizationId: orgId, role: "MEMBER", canCommit: true, status: "ACTIVE" },
      ],
    });

    const list = await prisma.savedList.create({
      data: {
        organizationId: orgId,
        name: "RS-IT plan",
        briefText: "Original brief",
        items: { create: [{ productId, quantity: 2 }, { titleId, quantity: 1, sortOrder: 1 }] },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    listId = list.id;
    itemId = list.items[0].id;

    // A sent (open) quote and an expired one, on a submitted request.
    const plan = await prisma.plan.create({
      data: { organizationId: orgId, name: "RS-IT plan", items: { create: [{ productId, quantity: 1 }] } },
    });
    requestId = (await prisma.request.create({ data: { organizationId: orgId, planId: plan.id, status: "QUOTED" } })).id;
    quoteId = (
      await prisma.quote.create({
        data: {
          requestId,
          status: "SENT",
          currency: "NOK",
          subtotal: 15000,
          vatPct: 25,
          total: 18750,
          validUntil: new Date(Date.now() + 7 * 86_400_000),
          lines: {
            create: [{ kind: "INVENTORY", productId, description: "RS-IT line", quantity: 1, unitCost: 10000, marginPct: 50, lineTotal: 15000 }],
          },
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { actor: { in: [viewerId, memberId] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [viewerId, memberId] } } });
    // The member's accept (control test) created an order, and told the desk.
    const orders = await prisma.order.findMany({ where: { organizationId: orgId }, select: { id: true } });
    for (const o of orders) await prisma.notification.deleteMany({ where: { link: { endsWith: `/orders/${o.id}` } } });
    await prisma.publisherBooking.deleteMany({ where: { orderLine: { order: { organizationId: orgId } } } });
    await prisma.contentBrief.deleteMany({ where: { orderLine: { order: { organizationId: orgId } } } });
    await prisma.orderLine.deleteMany({ where: { order: { organizationId: orgId } } });
    await prisma.order.deleteMany({ where: { organizationId: orgId } });
    await prisma.quoteLine.deleteMany({ where: { quote: { request: { organizationId: orgId } } } });
    await prisma.quote.deleteMany({ where: { request: { organizationId: orgId } } });
    await prisma.request.deleteMany({ where: { organizationId: orgId } });
    await prisma.planItem.deleteMany({ where: { plan: { organizationId: orgId } } });
    await prisma.plan.deleteMany({ where: { organizationId: orgId } });
    await prisma.contentAsset.deleteMany({ where: { article: { organizationId: orgId } } });
    await prisma.article.deleteMany({ where: { organizationId: orgId } });
    await prisma.savedListItem.deleteMany({ where: { list: { organizationId: orgId } } });
    await prisma.savedList.deleteMany({ where: { organizationId: orgId } });
    await prisma.campaignProgramme.deleteMany({ where: { organizationId: orgId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: [viewerId, memberId] } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
    mock.reset();
  });

  const asViewer = () => {
    actingUser = { id: viewerId, role: "BUYER", email: `${REF}-viewer@example.test` };
    jar.clear();
  };
  const asMember = () => {
    actingUser = { id: memberId, role: "BUYER", email: `${REF}-member@example.test` };
    jar.clear();
  };
  const listState = () =>
    prisma.savedList.findUniqueOrThrow({
      where: { id: listId },
      select: {
        name: true,
        briefText: true,
        archivedAt: true,
        shareToken: true,
        items: { orderBy: { id: "asc" }, select: { id: true, quantity: true, sortOrder: true } },
      },
    });
  const listCount = () => prisma.savedList.count({ where: { organizationId: orgId } });

  test("plan edits by a view-only seat are refused and change nothing", async () => {
    asViewer();
    const before = await listState();
    const lists0 = await listCount();

    assert.match(await redirectOf(lists.renameList(form({ listId, name: "Hacked" }))), /notice=plan-read-only/);
    assert.match(await redirectOf(lists.removeListItem(form({ itemId }))), /notice=plan-read-only/);
    assert.match(await redirectOf(lists.setListItemQuantity(form({ itemId, quantity: "9" }))), /notice=plan-read-only/);
    assert.match(await redirectOf(lists.setListItemNote(form({ itemId, note: "x" }))), /notice=plan-read-only/);
    assert.match(await redirectOf(lists.shareList(form({ listId }))), /notice=plan-read-only/);
    assert.match(await redirectOf(lists.createList(form({ name: "New" }))), /notice=plan-read-only/);
    await redirectOf(lists.archiveList(form({ listId })));
    await redirectOf(lists.duplicateList(form({ listId })));
    assert.deepEqual(
      await lists.reorderListItems({ listId, section: "plan", itemIds: [...before.items].reverse().map((i) => i.id) }),
      { ok: false },
    );
    assert.deepEqual(await lists.savePlanBrief(listId, { briefText: "Hacked brief" }), { ok: false });
    assert.deepEqual(await lists.addProductToActiveList(productId, "en"), { ok: false, reason: "read-only" });
    await lists.setListTitleMembership(form({ listId, titleId, member: "0" }));

    assert.deepEqual(await listState(), before, "the plan is exactly as it was");
    assert.equal(await listCount(), lists0, "no plan was created or duplicated");
  });

  test("opening a plan is still allowed for a view-only seat", async () => {
    asViewer();
    const to = await redirectOf(lists.selectActiveList(form({ listId })));
    assert.match(to, new RegExp(`/en/plan/${listId}`));
    assert.doesNotMatch(to, /notice=/);
  });

  test("sending, accepting, renewing, programmes, articles and billing are refused", async () => {
    asViewer();
    const requests0 = await prisma.request.count({ where: { organizationId: orgId } });

    assert.match(
      await redirectOf(checkout.submitRequest(form({ listId, briefText: "Go" }))),
      /notice=plan-read-only/,
    );
    assert.equal(await prisma.request.count({ where: { organizationId: orgId } }), requests0, "nothing sent to the desk");

    await redirectOf(quotes.acceptAllQuotesForRequest(form({ requestId })));
    await redirectOf(quotes.acceptQuote(form({ quoteId })));
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).status, "SENT", "not accepted");
    assert.equal(await prisma.order.count({ where: { organizationId: orgId } }), 0);

    await prisma.quote.update({ where: { id: quoteId }, data: { validUntil: new Date(Date.now() - 1000) } });
    await redirectOf(quotes.requestQuoteRenewal(form({ requestId })));
    assert.equal(
      await prisma.auditLog.count({ where: { entity: `Request:${requestId}`, action: "quote.renewal_requested" } }),
      0,
      "the desk was not asked",
    );
    await prisma.quote.update({ where: { id: quoteId }, data: { validUntil: new Date(Date.now() + 7 * 86_400_000) } });

    await redirectOf(programmes.startProgramme(form({ listId, waves: "3", spacingWeeks: "4" })));
    assert.equal(await prisma.campaignProgramme.count({ where: { organizationId: orgId } }), 0);

    await redirectOf(articles.createArticle(form({ organizationId: orgId, title: "Hacked article" })));
    assert.equal(await prisma.article.count({ where: { organizationId: orgId } }), 0);

    // A draft in review, written for the org by the desk: approving it or
    // asking for changes is the member's call, not a view-only seat's.
    const draftArticle = await prisma.article.create({
      data: {
        organizationId: orgId,
        title: "Desk draft",
        createdByUserId: memberId,
        createdByRole: "BUYER",
        versions: { create: [{ status: "IN_REVIEW", body: "Draft" }] },
      },
      include: { versions: true },
    });
    const assetId = draftArticle.versions[0].id;
    await redirectOf(review.approveContentAsset(form({ assetId })));
    await redirectOf(review.requestContentChanges(form({ assetId, note: "No" })));
    assert.equal((await prisma.contentAsset.findUniqueOrThrow({ where: { id: assetId } })).status, "IN_REVIEW");
    // …nor may it write into the article.
    await redirectOf(desk.saveDraft(form({ articleId: draftArticle.id, body: "Hacked" })));
    assert.equal(await prisma.contentAsset.count({ where: { articleId: draftArticle.id } }), 1);
    await prisma.contentAsset.deleteMany({ where: { articleId: draftArticle.id } });
    await prisma.article.delete({ where: { id: draftArticle.id } });

    await redirectOf(campaign.saveKyc(form({ legalName: "Hacked AS" })));
    assert.equal(
      (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).legalName,
      "Original AS",
    );
  });

  // The same calls succeed for a MEMBER of the same org, so the refusals above
  // come from the view-only seat, not from a broken fixture.
  test("control: a MEMBER of the same org can make those changes", async () => {
    asMember();
    await redirectOf(lists.renameList(form({ listId, name: "Renamed by member" })));
    assert.equal((await listState()).name, "Renamed by member");
    assert.deepEqual(await lists.savePlanBrief(listId, { briefText: "Member brief" }), { ok: true });
    await redirectOf(articles.createArticle(form({ organizationId: orgId, title: "Member article" })));
    assert.equal(await prisma.article.count({ where: { organizationId: orgId } }), 1);
    // The accept form posts the offer the page shows (lib/commerce/quote-offer.ts).
    const shown = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { lines: true } });
    await redirectOf(quotes.acceptAllQuotesForRequest(form({ requestId, offer: offerToken(shown) })));
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).status, "ACCEPTED");
  });

  test("the database refuses commit authority on a view-only seat", async () => {
    await assert.rejects(
      prisma.membership.update({
        where: { userId_organizationId: { userId: viewerId, organizationId: orgId } },
        data: { canCommit: true },
      }),
      /Membership_restricted_never_commits/,
    );
  });
}
