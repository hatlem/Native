import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadWorkspace } from "@/lib/workspace";
import { buyerScope, type BuyerScope } from "@/lib/data/buyer/guard";
import { loadDetailRequest, loadListRequests } from "@/lib/data/buyer/requests";
import { loadArchivedLists, loadLists } from "@/lib/data/buyer/lists";
import { loadListArticles } from "@/lib/data/buyer/articles";
import { loadRows, loadTotal, loadUnread } from "@/lib/data/buyer/notifications";
import { loadPlanActiveOrg, loadPlanLists, loadProgrammeOtherArticles } from "@/lib/data/buyer/plan";
import { loadDetailOrder, loadListOrders } from "@/lib/data/buyer/orders";
import { loadDetailInvoice, loadListInvoices, loadListTotal } from "@/lib/data/buyer/invoices";
import { loadOrders as loadHomeOrders } from "@/lib/data/buyer/home";
import { loadOrders as loadReportOrders } from "@/lib/data/buyer/reports";

// DB integration test — skipped unless RUN_DB_IT=1, against a DISPOSABLE
// database. The buyer loaders enforce the organisation boundary themselves:
//   1. a list loader returns the caller's organisation's rows and none of
//      another organisation's
//   2. a by-id loader answers null for another organisation's row
//   3. a loader asked for another organisation by id returns nothing
//   4. notifications are the caller's own
//   5. no signed-in user: list loaders refuse, by-id loaders answer null
//   6. the desk reads any organisation's row by id
//   7. orders and invoices: lists hold only the caller's, by-id answers null
//      for another organisation's
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("buyer loaders integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const REF = `bl-it-${Date.now()}`;
  let orgA = "";
  let orgB = "";
  const userIds: string[] = [];
  let alice: BuyerScope; // admin of A
  let bob: BuyerScope; // admin of B
  let desk: BuyerScope;
  const anonymous: BuyerScope = buyerScope(null, null);
  let requestA = "";
  let requestB = "";
  let listA = "";
  let listB = "";
  let archivedB = "";
  let articleA = "";
  let articleB = "";
  let orderA = "";
  let orderB = "";
  let invoiceA = "";
  let invoiceB = "";

  // A confirmed order on the request, with one issued invoice.
  async function seedOrder(organizationId: string, requestId: string): Promise<{ order: string; invoice: string }> {
    const money = { currency: "NOK", subtotal: 1000, vatPct: 25, total: 1250 };
    const quote = await prisma.quote.create({ data: { requestId, ...money, status: "ACCEPTED" } });
    const order = await prisma.order.create({
      data: { organizationId, quoteId: quote.id, status: "CONFIRMED" },
    });
    const invoice = await prisma.invoice.create({
      data: { organizationId, orderId: order.id, ...money, status: "ISSUED", issuedAt: new Date() },
    });
    return { order: order.id, invoice: invoice.id };
  }

  async function seat(label: string, organizationId: string): Promise<BuyerScope> {
    const user = await prisma.user.create({
      data: { email: `${REF}-${label}@example.test`, role: "BUYER", organizationId },
    });
    userIds.push(user.id);
    await prisma.membership.create({
      data: { userId: user.id, organizationId, role: "ADMIN", canCommit: true },
    });
    const workspace = await loadWorkspace(user.id, organizationId);
    assert.ok(workspace, `workspace for ${label}`);
    return buyerScope({ id: user.id, role: "BUYER" }, workspace);
  }

  async function seedRequest(organizationId: string): Promise<string> {
    const plan = await prisma.plan.create({ data: { organizationId, name: `${REF} plan` } });
    const request = await prisma.request.create({
      data: { organizationId, planId: plan.id, status: "SUBMITTED" },
    });
    return request.id;
  }

  before(async () => {
    orgA = (
      await prisma.organization.create({
        data: { name: `BL-IT A ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO" },
      })
    ).id;
    orgB = (
      await prisma.organization.create({
        data: { name: `BL-IT B ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO" },
      })
    ).id;
    alice = await seat("alice", orgA);
    bob = await seat("bob", orgB);
    const deskUser = await prisma.user.create({ data: { email: `${REF}-desk@example.test`, role: "DESK" } });
    userIds.push(deskUser.id);
    desk = buyerScope({ id: deskUser.id, role: "DESK" }, null);

    requestA = await seedRequest(orgA);
    requestB = await seedRequest(orgB);
    ({ order: orderA, invoice: invoiceA } = await seedOrder(orgA, requestA));
    ({ order: orderB, invoice: invoiceB } = await seedOrder(orgB, requestB));
    listA = (await prisma.savedList.create({ data: { organizationId: orgA, name: `${REF} list A` } })).id;
    listB = (await prisma.savedList.create({ data: { organizationId: orgB, name: `${REF} list B` } })).id;
    archivedB = (
      await prisma.savedList.create({
        data: { organizationId: orgB, name: `${REF} archived B`, archivedAt: new Date() },
      })
    ).id;
    articleA = (
      await prisma.article.create({
        data: { organizationId: orgA, title: `${REF} article A`, createdByUserId: alice.userId!, createdByRole: "BUYER" },
      })
    ).id;
    articleB = (
      await prisma.article.create({
        data: { organizationId: orgB, title: `${REF} article B`, createdByUserId: bob.userId!, createdByRole: "BUYER" },
      })
    ).id;
    await prisma.notification.createMany({
      data: [
        { userId: alice.userId!, kind: "QUOTE_READY", title: `${REF} for alice 1` },
        { userId: alice.userId!, kind: "QUOTE_READY", title: `${REF} for alice 2`, readAt: new Date() },
        { userId: bob.userId!, kind: "QUOTE_READY", title: `${REF} for bob` },
      ],
    });
  });

  after(async () => {
    const orgIn = { in: [orgA, orgB] };
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.article.deleteMany({ where: { organizationId: orgIn } });
    await prisma.savedList.deleteMany({ where: { organizationId: orgIn } });
    await prisma.invoice.deleteMany({ where: { organizationId: orgIn } });
    await prisma.order.deleteMany({ where: { organizationId: orgIn } });
    await prisma.quote.deleteMany({ where: { request: { organizationId: orgIn } } });
    await prisma.request.deleteMany({ where: { organizationId: orgIn } });
    await prisma.plan.deleteMany({ where: { organizationId: orgIn } });
    await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: orgIn } });
  });

  test("a list loader returns the caller's organisation's rows and none of another's", async () => {
    const forAlice = (await loadListRequests(alice)).map((r) => r.id);
    assert.ok(forAlice.includes(requestA));
    assert.ok(!forAlice.includes(requestB));
    const forBob = (await loadListRequests(bob)).map((r) => r.id);
    assert.deepEqual(forBob, [requestB]);

    const articles = (await loadListArticles(alice)).map((a) => a.id);
    assert.ok(articles.includes(articleA));
    assert.ok(!articles.includes(articleB));
  });

  test("a by-id loader answers null for another organisation's row", async () => {
    assert.equal((await loadDetailRequest(alice, { id: requestA }))?.id, requestA);
    assert.equal(await loadDetailRequest(alice, { id: requestB }), null);
    assert.equal(await loadDetailRequest(bob, { id: requestA }), null);
    // Same answer as a row that does not exist.
    assert.equal(await loadDetailRequest(alice, { id: "does-not-exist" }), null);
  });

  test("a loader asked for another organisation by id returns nothing", async () => {
    assert.deepEqual(
      (await loadLists(alice, { orgId: orgA })).map((l) => l.id),
      [listA],
    );
    assert.deepEqual(await loadLists(alice, { orgId: orgB }), []);
    assert.deepEqual(await loadArchivedLists(alice, { orgId: orgB, ARCHIVED_SHOWN: 10 }), []);
    assert.deepEqual(
      (await loadArchivedLists(bob, { orgId: orgB, ARCHIVED_SHOWN: 10 })).map((l) => l.id),
      [archivedB],
    );

    assert.deepEqual(await loadPlanLists(alice, { wsActiveOrgId: orgB }), []);
    assert.deepEqual(
      (await loadPlanLists(bob, { wsActiveOrgId: orgB })).map((l) => l.id),
      [listB],
    );
    assert.equal(await loadPlanActiveOrg(alice, { wsActiveOrgId: orgB }), null);
    assert.ok(await loadPlanActiveOrg(alice, { wsActiveOrgId: orgA }));
    assert.deepEqual(await loadProgrammeOtherArticles(alice, { listOrganizationId: orgB }), []);
    assert.deepEqual(
      (await loadProgrammeOtherArticles(alice, { listOrganizationId: orgA })).map((a) => a.id),
      [articleA],
    );
  });

  test("notifications are the caller's own", async () => {
    assert.equal(await loadTotal(alice), 2);
    assert.equal(await loadUnread(alice), 1);
    assert.equal(await loadTotal(bob), 1);
    const rows = await loadRows(alice, { skip: 0, take: 10 });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.title.includes("for alice")));
  });

  test("no signed-in user: list loaders refuse, by-id loaders answer null", async () => {
    await assert.rejects(loadListRequests(anonymous), /signed-in scope/);
    await assert.rejects(loadTotal(anonymous), /signed-in scope/);
    await assert.rejects(loadLists(anonymous, { orgId: orgA }), /signed-in scope/);
    assert.equal(await loadDetailRequest(anonymous, { id: requestA }), null);
  });

  test("a signed-in user with no workspace cannot list", async () => {
    const stray = buyerScope({ id: alice.userId, role: "BUYER" }, null);
    await assert.rejects(loadListRequests(stray), /without a workspace/);
    assert.equal(await loadDetailRequest(stray, { id: requestA }), null);
  });

  test("the desk reads any organisation's row by id", async () => {
    assert.equal((await loadDetailRequest(desk, { id: requestA }))?.id, requestA);
    assert.equal((await loadDetailRequest(desk, { id: requestB }))?.id, requestB);
    assert.equal((await loadDetailOrder(desk, { orderId: orderB }))?.id, orderB);
    assert.equal((await loadDetailInvoice(desk, { id: invoiceB }))?.id, invoiceB);
  });

  test("orders and invoices: the caller's own only", async () => {
    const orders = (await loadListOrders(alice, { orderBy: { createdAt: "desc" } })).map((o) => o.id);
    assert.deepEqual(orders, [orderA]);
    assert.deepEqual((await loadHomeOrders(alice)).map((o) => o.id), [orderA]);
    assert.equal((await loadReportOrders(alice)).length, 1);
    assert.equal((await loadDetailOrder(alice, { orderId: orderA }))?.id, orderA);
    assert.equal(await loadDetailOrder(alice, { orderId: orderB }), null);
    assert.equal(await loadDetailOrder(anonymous, { orderId: orderA }), null);

    assert.equal(await loadListTotal(alice), 1);
    assert.deepEqual(
      (await loadListInvoices(alice, { skip: 0, take: 50 })).map((i) => i.id),
      [invoiceA],
    );
    assert.equal((await loadDetailInvoice(alice, { id: invoiceA }))?.id, invoiceA);
    assert.equal(await loadDetailInvoice(alice, { id: invoiceB }), null);
    assert.equal(await loadDetailInvoice(bob, { id: invoiceA }), null);
    await assert.rejects(loadListTotal(anonymous), /signed-in scope/);
  });
}
