import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import {
  ensureActiveList,
  addProductItem,
  addTitleItem,
  resolveTitleItem,
  migrateLegacyBasket,
  snapshotListToPlanData,
} from "./lists";

let orgId = "";
let productId = "";
let titleId = "";

before(async () => {
  const market = await prisma.market.findFirst();
  const org = await prisma.organization.create({
    data: { name: "Lists IT Org", type: "AGENCY", marketCode: market?.code ?? "NO" },
  });
  orgId = org.id;
  const title = await prisma.title.findFirst({ where: { products: { some: {} } }, include: { products: true } });
  titleId = title!.id;
  productId = title!.products[0].id;
});

after(async () => {
  await prisma.savedListItem.deleteMany({ where: { list: { organizationId: orgId } } });
  await prisma.savedList.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
});

test("ensureActiveList lazily creates one when none exists", async () => {
  const list = await ensureActiveList(orgId, null);
  assert.equal(list.organizationId, orgId);
  assert.equal(list.items.length, 0);
});

test("addProductItem then addTitleItem builds a mixed list", async () => {
  const list = await ensureActiveList(orgId, null);
  await addProductItem(list.id, productId);
  await addTitleItem(list.id, titleId);
  const reloaded = await prisma.savedList.findUnique({ where: { id: list.id }, include: { items: true } });
  assert.equal(reloaded!.items.length, 2);
  assert.ok(reloaded!.items.some((i) => i.productId === productId && i.titleId === null));
  assert.ok(reloaded!.items.some((i) => i.titleId === titleId && i.productId === null));
});

test("resolveTitleItem converts a title placeholder into a product line", async () => {
  const list = await ensureActiveList(orgId, null);
  const item = await addTitleItem(list.id, titleId);
  await resolveTitleItem(item.id, productId);
  const reloaded = await prisma.savedListItem.findUnique({ where: { id: item.id } });
  assert.equal(reloaded!.titleId, null);
  assert.equal(reloaded!.productId, productId);
});

test("migrateLegacyBasket folds a cookie basket into a new list", async () => {
  const list = await migrateLegacyBasket(orgId, [{ productId, quantity: 3 }], null);
  assert.ok(list);
  const reloaded = await prisma.savedList.findUnique({ where: { id: list!.id }, include: { items: true } });
  assert.equal(reloaded!.items.length, 1);
  assert.equal(reloaded!.items[0].productId, productId);
  assert.equal(reloaded!.items[0].quantity, 3);
});

test("migrateLegacyBasket returns null for an empty basket", async () => {
  assert.equal(await migrateLegacyBasket(orgId, [], null), null);
});

test("migrateLegacyBasket drops products that are no longer active/bookable", async () => {
  const list = await migrateLegacyBasket(orgId, [{ productId: "definitely-not-a-real-product-id", quantity: 1 }], null);
  assert.equal(list, null);
});

// ── Group 1 — idempotency / quantity-bump ──────────────────────────────────
// Each ensureActiveList(orgId, null) creates a FRESH list, so these are independent.

test("addProductItem bumps quantity instead of duplicating when product already on list", async () => {
  const list = await ensureActiveList(orgId, null);
  await addProductItem(list.id, productId);
  await addProductItem(list.id, productId);
  const items = await prisma.savedListItem.findMany({ where: { listId: list.id, productId } });
  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 2);
});

test("addProductItem respects the quantity clamp on repeated adds", async () => {
  const list = await ensureActiveList(orgId, null);
  // first add → qty 1, then 24 more adds; clamp is 20
  for (let i = 0; i < 25; i++) await addProductItem(list.id, productId);
  const item = await prisma.savedListItem.findFirst({ where: { listId: list.id, productId } });
  assert.equal(item!.quantity, 20);
});

test("addTitleItem is idempotent — no duplicate title placeholder", async () => {
  const list = await ensureActiveList(orgId, null);
  const a = await addTitleItem(list.id, titleId);
  const b = await addTitleItem(list.id, titleId);
  assert.equal(a.id, b.id);
  const items = await prisma.savedListItem.findMany({ where: { listId: list.id, titleId } });
  assert.equal(items.length, 1);
});

// ── Group 2 — scope isolation (cross-org) ──────────────────────────────────

test("a second org's list is not visible under the first org's scope", async () => {
  const other = await prisma.organization.create({
    data: { name: "Other Org Task9", type: "ADVERTISER", marketCode: "NO" },
  });
  const otherList = await prisma.savedList.create({ data: { organizationId: other.id, name: "Theirs" } });

  // Query as the first org would (the /lists + /plan pages scope by organizationId):
  const visibleToFirst = await prisma.savedList.findMany({ where: { organizationId: orgId, archivedAt: null } });
  assert.ok(!visibleToFirst.some((l) => l.id === otherList.id));

  // ensureActiveList with the other org's list id under OUR org must NOT reuse it — it creates a fresh list for orgId.
  const resolved = await ensureActiveList(orgId, otherList.id);
  assert.notEqual(resolved.id, otherList.id);
  assert.equal(resolved.organizationId, orgId);

  await prisma.savedListItem.deleteMany({ where: { listId: otherList.id } });
  await prisma.savedList.delete({ where: { id: otherList.id } });
  await prisma.organization.delete({ where: { id: other.id } });
});

// ── Group 3 — mixed-list snapshot preserves the list (durability guarantee) ─

test("snapshot of a mixed list yields product + title PlanItems and preserves the list", async () => {
  const list = await ensureActiveList(orgId, null);
  await addProductItem(list.id, productId);
  await addTitleItem(list.id, titleId);
  const reloaded = await prisma.savedList.findUnique({ where: { id: list.id }, include: { items: true } });
  const planData = snapshotListToPlanData(reloaded!.items);

  const plan = await prisma.plan.create({
    data: { organizationId: orgId, name: list.name, items: { create: planData } },
    include: { items: true },
  });
  assert.equal(plan.items.length, 2);
  assert.ok(plan.items.some((i) => i.productId === productId && i.titleId === null));
  assert.ok(plan.items.some((i) => i.titleId === titleId && i.productId === null));

  // durability: the source list still exists after snapshotting
  assert.ok(await prisma.savedList.findUnique({ where: { id: list.id } }));

  await prisma.planItem.deleteMany({ where: { planId: plan.id } });
  await prisma.plan.delete({ where: { id: plan.id } });
});
