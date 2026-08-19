import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const TEST_EMAILS = [
  "stine.vogt.run2@getia.no",
  "sebastian.kjaer.run1@getia.no",
  "linnea.bauer.run1@getia.no",
  "klaus-dieter.wendt.run1@getia.no",
  "stine.vogt.run3@getia.no",
];
async function main() {
  console.log("== before ==");
  const users = await p.user.findMany({ where: { email: { in: TEST_EMAILS } }, include: { organization: true } });
  for (const u of users) console.log(" user:", u.email, "org:", u.organization?.name, "id:", u.id);

  const requests = await p.request.findMany({ where: { organization: { users: { some: { email: { in: TEST_EMAILS } } } } } });
  for (const r of requests) console.log(" req:", r.id, "status:", r.status);

  const sc = await p.salesContact.findMany({ where: { email: { in: TEST_EMAILS } } });
  for (const c of sc) console.log(" sales-contact:", c.id, c.email, c.name);

  const prs = await p.priceRequest.findMany({ where: { salesContact: { email: { in: TEST_EMAILS } } } });
  for (const pr of prs) console.log(" price-req:", pr.id);

  console.log("\n== DELETING ==");
  // Order matters: child rows first.
  // Price-request → its responses/quotes/contact link
  for (const pr of prs) {
    await p.priceRequest.delete({ where: { id: pr.id } }).catch((e) => console.log("  pr-skip", pr.id, e.message));
    console.log("  pr deleted:", pr.id);
  }
  for (const c of sc) {
    await p.salesContactTitle.deleteMany({ where: { salesContactId: c.id } });
    await p.salesContact.delete({ where: { id: c.id } }).catch((e) => console.log("  sc-skip", c.id, e.message));
    console.log("  sales-contact deleted:", c.id);
  }
  for (const r of requests) {
    // request → quotes → quote-lines + order
    const quotes = await p.quote.findMany({ where: { requestId: r.id } });
    for (const q of quotes) {
      const order = await p.order.findUnique({ where: { quoteId: q.id } });
      if (order) {
        // ArticlePlacement.orderLineId is now ON DELETE RESTRICT (was SET
        // NULL on the old Article.orderLineId FK) — clear placements before
        // deleting their OrderLines or the deleteMany below fails.
        await p.articlePlacement.deleteMany({ where: { orderLine: { orderId: order.id } } });
        await p.orderLine.deleteMany({ where: { orderId: order.id } });
        await p.invoice.deleteMany({ where: { orderId: order.id } });
        await p.creditNote.deleteMany({ where: { orderId: order.id } });
        await p.order.delete({ where: { id: order.id } });
        console.log("  order deleted:", order.id);
      }
      await p.quoteLine.deleteMany({ where: { quoteId: q.id } });
      await p.quote.delete({ where: { id: q.id } });
      console.log("  quote deleted:", q.id);
    }
    const planId = r.planId;
    await p.request.delete({ where: { id: r.id } });
    console.log("  request deleted:", r.id);
    await p.planItem.deleteMany({ where: { planId } });
    await p.plan.delete({ where: { id: planId } }).catch(() => {});
    console.log("  plan deleted:", planId);
  }
  // Users + their orgs (orgs have only the test user attached typically)
  for (const u of users) {
    await p.magicLinkToken.deleteMany({ where: { userId: u.id } });
    await p.notification.deleteMany({ where: { userId: u.id } });
    await p.user.delete({ where: { id: u.id } });
    console.log("  user deleted:", u.email);
    if (u.organizationId) {
      // Only delete org if no other users remain.
      const remaining = await p.user.count({ where: { organizationId: u.organizationId } });
      if (remaining === 0) {
        await p.organization.delete({ where: { id: u.organizationId } }).catch((e) => console.log("  org-skip", u.organizationId, e.message));
        console.log("  org deleted:", u.organization?.name);
      }
    }
  }
  await p.$disconnect();
  console.log("\n== done ==");
}
main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
