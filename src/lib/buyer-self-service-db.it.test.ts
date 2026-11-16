import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadWorkspace } from "@/lib/workspace";
import {
  declineQuoteForBuyer,
  requestOrderCancellationForBuyer,
  withdrawRequestForBuyer,
  type SelfServiceScope,
} from "@/lib/buyer-self-service-db";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only against
// a DISPOSABLE database. Buyer self-service against real rows and real seats:
//   1. decline: only a commit seat in the quote's own org; a SENT quote with
//      no order; the request closes when nothing is left open
//   2. withdraw: an editing seat; refused once any quote became an order;
//      open quotes are declined with the same reason
//   3. cancellation request: needs a reason, is a request (status untouched),
//      one open ask at a time
//   4. org scoping: a member of another organisation gets "forbidden" on all
//      three and nothing is written
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("buyer self-service integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const REF = `bss-it-${Date.now()}`;
  let publisherId = "";
  let productId = "";
  let orgId = "";
  let otherOrgId = "";
  const userIds: string[] = [];
  let admin: SelfServiceScope;
  let member: SelfServiceScope; // edits, cannot commit
  let viewer: SelfServiceScope; // RESTRICTED: view-only
  let outsider: SelfServiceScope; // admin of another org
  let desk: SelfServiceScope;

  async function seat(
    label: string,
    organizationId: string,
    role: "ADMIN" | "MEMBER" | "RESTRICTED",
    canCommit: boolean,
  ): Promise<SelfServiceScope> {
    const user = await prisma.user.create({
      data: { email: `${REF}-${label}@example.test`, role: "BUYER", organizationId },
    });
    userIds.push(user.id);
    await prisma.membership.create({
      data: { userId: user.id, organizationId, role, canCommit },
    });
    const workspace = await loadWorkspace(user.id, organizationId);
    assert.ok(workspace, `workspace for ${label}`);
    return { userId: user.id, isDesk: false, workspace };
  }

  before(async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    publisherId = (
      await prisma.publisher.create({
        data: { name: `BSS-IT publisher ${REF}`, countryCode: market.code, marketId: market.id },
      })
    ).id;
    const title = await prisma.title.create({
      data: {
        name: "BSS-IT Title",
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
        data: { titleId: title.id, type: "ADVERTORIAL", name: "BSS-IT advertorial", basePrice: 10000, currency: "NOK" },
      })
    ).id;
    orgId = (
      await prisma.organization.create({
        data: { name: `BSS-IT org ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO" },
      })
    ).id;
    otherOrgId = (
      await prisma.organization.create({
        data: { name: `BSS-IT other ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO" },
      })
    ).id;
    admin = await seat("admin", orgId, "ADMIN", true);
    member = await seat("member", orgId, "MEMBER", false);
    viewer = await seat("viewer", orgId, "RESTRICTED", false);
    outsider = await seat("outsider", otherOrgId, "ADMIN", true);
    const deskUser = await prisma.user.create({ data: { email: `${REF}-desk@example.test`, role: "DESK" } });
    userIds.push(deskUser.id);
    desk = { userId: deskUser.id, isDesk: true, workspace: null };
  });

  after(async () => {
    const orgIn = { in: [orgId, otherOrgId] };
    await prisma.orderLine.deleteMany({ where: { order: { organizationId: orgIn } } });
    await prisma.order.deleteMany({ where: { organizationId: orgIn } });
    await prisma.quoteLine.deleteMany({ where: { quote: { request: { organizationId: orgIn } } } });
    await prisma.quote.deleteMany({ where: { request: { organizationId: orgIn } } });
    await prisma.request.deleteMany({ where: { organizationId: orgIn } });
    await prisma.planItem.deleteMany({ where: { plan: { organizationId: orgIn } } });
    await prisma.plan.deleteMany({ where: { organizationId: orgIn } });
    await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: orgIn } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.title.deleteMany({ where: { publisherId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
  });

  // A request with `quotes` quotes in the given statuses.
  async function seedRequest(
    requestStatus: "SUBMITTED" | "IN_REVIEW" | "QUOTED",
    quoteStatuses: ("DRAFT" | "SENT" | "ACCEPTED")[],
  ) {
    const plan = await prisma.plan.create({
      data: { organizationId: orgId, name: "BSS-IT plan", items: { create: [{ productId, quantity: 1 }] } },
    });
    const request = await prisma.request.create({
      data: { organizationId: orgId, planId: plan.id, status: requestStatus },
    });
    const quoteIds: string[] = [];
    for (const status of quoteStatuses) {
      const quote = await prisma.quote.create({
        data: { requestId: request.id, status, currency: "NOK", subtotal: 15000, vatPct: 25, total: 18750 },
      });
      quoteIds.push(quote.id);
    }
    return { requestId: request.id, quoteIds };
  }

  async function seedOrder(status: "CONFIRMED" | "LIVE" | "COMPLETED") {
    const { requestId, quoteIds } = await seedRequest("QUOTED", ["ACCEPTED"]);
    const order = await prisma.order.create({
      data: { organizationId: orgId, quoteId: quoteIds[0], status },
    });
    return { requestId, quoteId: quoteIds[0], orderId: order.id };
  }

  test("decline: commit seat only, SENT quote only, and the request closes when nothing is open", async () => {
    const { requestId, quoteIds } = await seedRequest("QUOTED", ["SENT", "SENT"]);
    const [first, second] = quoteIds;

    // A seat that edits but cannot commit, and a view-only seat, are refused.
    assert.equal((await declineQuoteForBuyer(member, first, "too expensive")).outcome, "not-allowed");
    assert.equal((await declineQuoteForBuyer(viewer, first, "too expensive")).outcome, "not-allowed");
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: first } })).status, "SENT");

    const declined = await declineQuoteForBuyer(admin, first, "too expensive");
    assert.equal(declined.outcome, "declined");
    if (declined.outcome !== "declined") return;
    assert.equal(declined.requestClosed, false, "another quote is still open");
    const row = await prisma.quote.findUniqueOrThrow({ where: { id: first } });
    assert.equal(row.status, "DECLINED");
    assert.equal(row.declineReason, "too expensive");
    assert.ok(row.declinedAt);
    assert.equal((await prisma.request.findUniqueOrThrow({ where: { id: requestId } })).status, "QUOTED");

    // Declining twice is refused and changes nothing.
    assert.equal((await declineQuoteForBuyer(admin, first, "again")).outcome, "unavailable");
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: first } })).declineReason, "too expensive");

    // The last open quote closes the request.
    const last = await declineQuoteForBuyer(admin, second, null);
    assert.equal(last.outcome, "declined");
    if (last.outcome === "declined") assert.equal(last.requestClosed, true);
    assert.equal((await prisma.request.findUniqueOrThrow({ where: { id: requestId } })).status, "CLOSED");

    assert.equal((await declineQuoteForBuyer(admin, "does-not-exist", null)).outcome, "not-found");
  });

  test("decline: a quote that already became an order cannot be declined", async () => {
    const { quoteId } = await seedOrder("CONFIRMED");
    assert.equal((await declineQuoteForBuyer(admin, quoteId, null)).outcome, "unavailable");
    // Even a SENT quote loses to an order on it (the concurrent-accept case).
    const { quoteIds } = await seedRequest("QUOTED", ["SENT"]);
    await prisma.order.create({
      data: { organizationId: orgId, quoteId: quoteIds[0], status: "CONFIRMED" },
    });
    assert.equal((await declineQuoteForBuyer(admin, quoteIds[0], null)).outcome, "unavailable");
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: quoteIds[0] } })).status, "SENT");
  });

  test("withdraw: an editing seat closes the request and declines its open quotes", async () => {
    const { requestId, quoteIds } = await seedRequest("QUOTED", ["DRAFT", "SENT"]);

    assert.equal((await withdrawRequestForBuyer(viewer, requestId, "changed plans")).outcome, "not-allowed");
    assert.equal((await prisma.request.findUniqueOrThrow({ where: { id: requestId } })).status, "QUOTED");

    // A member without commit rights may withdraw: nothing is being bought.
    const r = await withdrawRequestForBuyer(member, requestId, "changed plans");
    assert.equal(r.outcome, "withdrawn");
    const request = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(request.status, "CLOSED");
    assert.equal(request.withdrawReason, "changed plans");
    assert.ok(request.withdrawnAt);
    const quotes = await prisma.quote.findMany({ where: { id: { in: quoteIds } } });
    assert.deepEqual(quotes.map((q) => q.status).sort(), ["DECLINED", "DECLINED"]);
    assert.ok(quotes.every((q) => q.declineReason === "changed plans"));

    assert.equal((await withdrawRequestForBuyer(member, requestId, null)).outcome, "unavailable");
    assert.equal((await withdrawRequestForBuyer(member, "does-not-exist", null)).outcome, "not-found");
  });

  test("withdraw: refused once a quote on the request became an order", async () => {
    const { requestId } = await seedOrder("CONFIRMED");
    assert.equal((await withdrawRequestForBuyer(admin, requestId, null)).outcome, "unavailable");
    assert.equal((await prisma.request.findUniqueOrThrow({ where: { id: requestId } })).status, "QUOTED");

    // The order appears between the read and the write: the transaction's own
    // order count still refuses.
    const { requestId: racing, quoteIds } = await seedRequest("QUOTED", ["SENT"]);
    await prisma.order.create({
      data: { organizationId: orgId, quoteId: quoteIds[0], status: "CONFIRMED" },
    });
    assert.equal((await withdrawRequestForBuyer(admin, racing, null)).outcome, "unavailable");
    assert.equal((await prisma.request.findUniqueOrThrow({ where: { id: racing } })).withdrawnAt, null);
  });

  test("cancellation: a reasoned request from a commit seat, once, and the order status is untouched", async () => {
    const { orderId } = await seedOrder("CONFIRMED");

    assert.equal((await requestOrderCancellationForBuyer(member, orderId, "budget cut")).outcome, "not-allowed");
    assert.equal((await requestOrderCancellationForBuyer(admin, orderId, null)).outcome, "reason-required");

    const r = await requestOrderCancellationForBuyer(admin, orderId, "budget cut");
    assert.equal(r.outcome, "requested");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(order.status, "CONFIRMED", "a request, not a cancellation");
    assert.equal(order.cancellationRequestReason, "budget cut");
    assert.equal(order.cancellationRequestedBy, admin.userId);
    assert.ok(order.cancellationRequestedAt);

    // One open ask at a time.
    assert.equal((await requestOrderCancellationForBuyer(admin, orderId, "again")).outcome, "unavailable");
    assert.equal(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).cancellationRequestReason,
      "budget cut",
    );

    // Delivered work is not cancellable.
    const delivered = await seedOrder("COMPLETED");
    assert.equal(
      (await requestOrderCancellationForBuyer(admin, delivered.orderId, "too late")).outcome,
      "unavailable",
    );
    assert.equal((await requestOrderCancellationForBuyer(admin, "does-not-exist", "x")).outcome, "not-found");
  });

  test("org scoping: another organisation's member is forbidden everywhere and nothing is written", async () => {
    const { requestId, quoteIds } = await seedRequest("QUOTED", ["SENT"]);
    const { orderId } = await seedOrder("LIVE");

    assert.equal((await declineQuoteForBuyer(outsider, quoteIds[0], "not mine")).outcome, "forbidden");
    assert.equal((await withdrawRequestForBuyer(outsider, requestId, "not mine")).outcome, "forbidden");
    assert.equal((await requestOrderCancellationForBuyer(outsider, orderId, "not mine")).outcome, "forbidden");

    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: quoteIds[0] } })).status, "SENT");
    const request = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(request.status, "QUOTED");
    assert.equal(request.withdrawnAt, null);
    assert.equal(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).cancellationRequestedAt,
      null,
    );

    // A scope with no workspace at all (signed out) is forbidden too.
    const nobody: SelfServiceScope = { userId: undefined, isDesk: false, workspace: null };
    assert.equal((await declineQuoteForBuyer(nobody, quoteIds[0], null)).outcome, "forbidden");
    assert.equal((await withdrawRequestForBuyer(nobody, requestId, null)).outcome, "forbidden");
    assert.equal((await requestOrderCancellationForBuyer(nobody, orderId, "x")).outcome, "forbidden");

    // The desk may act on any organisation's rows.
    assert.equal((await withdrawRequestForBuyer(desk, requestId, "by desk")).outcome, "withdrawn");
  });
}
