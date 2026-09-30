import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { loadWorkspace, type Workspace } from "./workspace";
import { addProductItem, committedItems, ensureActiveListId, loadListWithItems } from "./lists";
import { resolvePlanTarget } from "./plan-target";
import { submitListAsRfq } from "./commerce/submit-rfq";

// BUG-buyer-plan-20: with plan A open in one tab and plan B in another, "Send"
// in plan A's tab submitted plan B, because submitRequest resolved the list
// from the active-list cookie (last plan opened in ANY tab). The page now posts
// its listId and the action resolves it through resolvePlanTarget. Server
// actions need a session and throw NEXT_REDIRECT, so, as in
// lists.flow.it.test.ts, this drives the same lib calls the action makes.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

let orgId = "";
let foreignOrgId = "";
let userId = "";
let ws: Workspace | null = null;
let planA = "";
let planB = "";
let archivedPlan = "";
let foreignPlan = "";
let productA = "";
let productB = "";

before(async () => {
  if (!RUN_DB_IT) return;
  const market = await prisma.market.findFirst({ select: { code: true } });
  const org = await prisma.organization.create({
    data: { name: "Plan target IT org", type: "ADVERTISER", marketCode: market!.code },
  });
  orgId = org.id;
  const foreign = await prisma.organization.create({
    data: { name: "Plan target IT foreign org", type: "ADVERTISER", marketCode: market!.code },
  });
  foreignOrgId = foreign.id;
  const user = await prisma.user.create({
    data: { email: `plan-target-it-${org.id}@example.com`, role: "BUYER", organizationId: orgId },
  });
  userId = user.id;
  await prisma.membership.create({
    data: { userId, organizationId: orgId, role: "ADMIN", canCommit: true, status: "ACTIVE" },
  });
  ws = await loadWorkspace(userId, null);

  const products = await prisma.product.findMany({
    where: { active: true, bookable: true },
    select: { id: true },
    take: 2,
  });
  productA = products[0].id;
  productB = products[1].id;

  planA = (await prisma.savedList.create({ data: { organizationId: orgId, name: "Plan A" } })).id;
  planB = (await prisma.savedList.create({ data: { organizationId: orgId, name: "Plan B" } })).id;
  await addProductItem(planA, productA);
  await addProductItem(planB, productB);
  archivedPlan = (
    await prisma.savedList.create({ data: { organizationId: orgId, name: "Archived", archivedAt: new Date() } })
  ).id;
  foreignPlan = (await prisma.savedList.create({ data: { organizationId: foreignOrgId, name: "Not yours" } })).id;
});

after(async () => {
  if (!RUN_DB_IT) return;
  const orgs = [orgId, foreignOrgId];
  await prisma.request.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.planItem.deleteMany({ where: { plan: { organizationId: { in: orgs } } } });
  await prisma.plan.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.savedListItem.deleteMany({ where: { list: { organizationId: { in: orgs } } } });
  await prisma.savedList.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.membership.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
});

if (!RUN_DB_IT) {
  test("plan target integration (skipped — set RUN_DB_IT=1)", { skip: true }, () => {});
} else {
  test("two tabs: submit acts on the POSTED plan, not the plan the cookie names", async () => {
    // Tab 2 opened plan B last, so the active-list cookie says B. The old
    // action resolved exactly this, and submitted B from plan A's tab:
    const cookieListId = planB;
    assert.equal(await ensureActiveListId(orgId, cookieListId), planB);

    // Tab 1 (showing plan A) posts listId=A. That is what gets submitted.
    const target = await resolvePlanTarget(ws, planA);
    assert.ok(target.ok);
    assert.equal(target.list.id, planA);
    assert.equal(target.list.organizationId, orgId);

    const list = await loadListWithItems(target.list.id);
    assert.ok(list);
    const result = await submitListAsRfq({
      list: { ...list, article: null },
      org: { id: orgId, name: "Plan target IT org" },
      brief: {
        text: "submitted from the tab showing plan A",
        goal: null,
        audience: null,
        budget: null,
        targetGeo: null,
        targetAudience: null,
        targetContext: null,
      },
      actorUserId: userId,
      locale: "no",
    });
    assert.equal(result.outcome, "submitted");
    assert.ok(result.outcome === "submitted");
    const request = await prisma.request.findUniqueOrThrow({
      where: { id: result.requestId },
      select: { sourceListId: true, plan: { select: { items: { select: { productId: true } } } } },
    });
    assert.equal(request.sourceListId, planA, "the request comes from plan A");
    assert.deepEqual(
      request.plan.items.map((i) => i.productId),
      committedItems(list.items).map((i) => i.productId),
    );
    assert.deepEqual(request.plan.items.map((i) => i.productId), [productA], "plan A's line, not plan B's");
  });

  test("a foreign, archived or unknown listId is refused", async () => {
    assert.deepEqual(await resolvePlanTarget(ws, foreignPlan), { ok: false, reason: "forbidden" });
    assert.deepEqual(await resolvePlanTarget(ws, archivedPlan), { ok: false, reason: "archived" });
    assert.deepEqual(await resolvePlanTarget(ws, "no-such-list"), { ok: false, reason: "missing" });
    assert.deepEqual(await resolvePlanTarget(ws, ""), { ok: false, reason: "missing" });
    // No workspace (signed out, access revoked): never acts on any plan.
    assert.deepEqual(await resolvePlanTarget(null, planA), { ok: false, reason: "forbidden" });
  });

  test("an archived foreign plan reads as forbidden, never revealing that it exists", async () => {
    await prisma.savedList.update({ where: { id: foreignPlan }, data: { archivedAt: new Date() } });
    assert.deepEqual(await resolvePlanTarget(ws, foreignPlan), { ok: false, reason: "forbidden" });
  });

  test("a revoked seat loses the plan even with its id in hand", async () => {
    await prisma.membership.update({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      data: { status: "REVOKED" },
    });
    const revoked = await loadWorkspace(userId, null);
    assert.deepEqual(await resolvePlanTarget(revoked, planA), { ok: false, reason: "forbidden" });
    await prisma.membership.update({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      data: { status: "ACTIVE" },
    });
  });
}
