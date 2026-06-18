import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import {
  ensureActiveList,
  ensureActiveListId,
  resolveActiveList,
  addProductItem,
  addTitleItem,
  resolveTitleItem,
  migrateLegacyBasket,
  snapshotListToPlanData,
} from "./lists";
import { rehomeSavedListItems } from "./commerce/rehome-saved-list-items";

let orgId = "";
let productId = "";
let titleId = "";
let productId2 = "";

before(async () => {
  const market = await prisma.market.findFirst();
  const org = await prisma.organization.create({
    data: { name: "Lists IT Org", type: "AGENCY", marketCode: market?.code ?? "NO" },
  });
  orgId = org.id;
  const title = await prisma.title.findFirst({ where: { products: { some: {} } }, include: { products: true } });
  titleId = title!.id;
  productId = title!.products[0].id;
  // a second, distinct bookable product for merge/cross tests
  const other = await prisma.product.findFirst({ where: { id: { not: productId }, active: true, bookable: true }, select: { id: true } });
  productId2 = other!.id;
});

after(async () => {
  await prisma.savedListItem.deleteMany({ where: { list: { organizationId: orgId } } });
  await prisma.savedList.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
});

/** An isolated empty list owned by orgId. ensureActiveList(orgId, null) now ADOPTS
 *  the org's most-recent list (the G-race fix), so tests that need a guaranteed-empty
 *  list create one explicitly rather than relying on lazy-create. */
async function freshList(): Promise<string> {
  const l = await prisma.savedList.create({ data: { organizationId: orgId } });
  return l.id;
}

// ── ensureActiveList: create / adopt / scope ───────────────────────────────

test("ensureActiveList creates a list when the org has none", async () => {
  const market = await prisma.market.findFirst();
  const empty = await prisma.organization.create({ data: { name: "Empty EAL", type: "ADVERTISER", marketCode: market?.code ?? "NO" } });
  const list = await ensureActiveList(empty.id, null);
  assert.equal(list.organizationId, empty.id);
  assert.equal(list.items.length, 0);
  await prisma.savedList.deleteMany({ where: { organizationId: empty.id } });
  await prisma.organization.delete({ where: { id: empty.id } });
});

test("ensureActiveList adopts the org's existing list instead of creating a second", async () => {
  const market = await prisma.market.findFirst();
  const org = await prisma.organization.create({ data: { name: "Adopt EAL", type: "ADVERTISER", marketCode: market?.code ?? "NO" } });
  const first = await ensureActiveListId(org.id, null);
  const second = await ensureActiveListId(org.id, null); // cookie empty again
  assert.equal(second, first, "second add with no cookie must adopt the same list");
  assert.equal(await prisma.savedList.count({ where: { organizationId: org.id } }), 1);
  await prisma.savedList.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("ensureActiveList rejects a cookie id from another org and stays in-scope", async () => {
  const market = await prisma.market.findFirst();
  const other = await prisma.organization.create({ data: { name: "Other EAL", type: "ADVERTISER", marketCode: market?.code ?? "NO" } });
  const theirs = await prisma.savedList.create({ data: { organizationId: other.id } });
  const resolved = await ensureActiveList(orgId, theirs.id);
  assert.notEqual(resolved.id, theirs.id);
  assert.equal(resolved.organizationId, orgId);
  await prisma.savedList.delete({ where: { id: theirs.id } });
  await prisma.organization.delete({ where: { id: other.id } });
});

// ── add / merge item mutations ─────────────────────────────────────────────

test("addProductItem then addTitleItem builds a mixed list", async () => {
  const listId = await freshList();
  await addProductItem(listId, productId);
  await addTitleItem(listId, titleId);
  const reloaded = await prisma.savedList.findUnique({ where: { id: listId }, include: { items: true } });
  assert.equal(reloaded!.items.length, 2);
  assert.ok(reloaded!.items.some((i) => i.productId === productId && i.titleId === null));
  assert.ok(reloaded!.items.some((i) => i.titleId === titleId && i.productId === null));
});

test("addProductItem upsert bumps quantity instead of duplicating", async () => {
  const listId = await freshList();
  await addProductItem(listId, productId);
  await addProductItem(listId, productId);
  const items = await prisma.savedListItem.findMany({ where: { listId, productId } });
  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 2);
});

test("addProductItem caps bumps at MAX_QTY (20)", async () => {
  const listId = await freshList();
  for (let i = 0; i < 25; i++) await addProductItem(listId, productId);
  const item = await prisma.savedListItem.findFirst({ where: { listId, productId } });
  assert.equal(item!.quantity, 20);
});

test("addTitleItem upsert is idempotent — no duplicate placeholder", async () => {
  const listId = await freshList();
  const a = await addTitleItem(listId, titleId);
  const b = await addTitleItem(listId, titleId);
  assert.equal(a.id, b.id);
  assert.equal(await prisma.savedListItem.count({ where: { listId, titleId } }), 1);
});

test("resolveTitleItem converts a title placeholder into a product line", async () => {
  const listId = await freshList();
  const item = await addTitleItem(listId, titleId);
  await resolveTitleItem(item.id, productId);
  const reloaded = await prisma.savedListItem.findUnique({ where: { id: item.id } });
  assert.equal(reloaded!.titleId, null);
  assert.equal(reloaded!.productId, productId);
});

test("resolveTitleItem merges into the existing product line when that product is already present", async () => {
  const listId = await freshList();
  await addProductItem(listId, productId); // product line, qty 1
  const placeholder = await addTitleItem(listId, titleId); // title placeholder
  const merged = await resolveTitleItem(placeholder.id, productId); // resolve to the same product
  // placeholder is gone; the single product line absorbed its quantity
  assert.equal(await prisma.savedListItem.findUnique({ where: { id: placeholder.id } }), null);
  const rows = await prisma.savedListItem.findMany({ where: { listId } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].productId, productId);
  assert.equal(rows[0].quantity, 2);
  assert.equal(merged!.id, rows[0].id);
});

// ── DB-level invariant enforcement (CHECK constraint) ──────────────────────

test("DB CHECK rejects a (null,null) item and a (both-set) item", async () => {
  const listId = await freshList();
  await assert.rejects(
    prisma.savedListItem.create({ data: { listId, productId: null, titleId: null } }),
    /violates check constraint|SavedListItem_one_ref_chk/i,
  );
  await assert.rejects(
    prisma.savedListItem.create({ data: { listId, productId, titleId } }),
    /violates check constraint|SavedListItem_one_ref_chk/i,
  );
});

test("DB CASCADE deletes saved-list items when their product is hard-deleted", async () => {
  // use a throwaway product clone so we can hard-delete it safely
  const src = await prisma.product.findUnique({ where: { id: productId } });
  const clone = await prisma.product.create({
    data: {
      titleId: src!.titleId, type: src!.type, name: src!.name + " (cascade-test)",
      basePrice: src!.basePrice, currency: src!.currency, pricingModel: src!.pricingModel,
      active: true, bookable: true,
    },
  });
  const listId = await freshList();
  const item = await addProductItem(listId, clone.id);
  await prisma.product.delete({ where: { id: clone.id } });
  // the item is gone (CASCADE), not left as a (null,null) orphan
  assert.equal(await prisma.savedListItem.findUnique({ where: { id: item.id } }), null);
});

// ── migrateLegacyBasket ────────────────────────────────────────────────────

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

// ── scope isolation (cross-org) ────────────────────────────────────────────

test("a second org's list is not visible under the first org's scope", async () => {
  const other = await prisma.organization.create({
    data: { name: "Other Org Task9", type: "ADVERTISER", marketCode: "NO" },
  });
  const otherList = await prisma.savedList.create({ data: { organizationId: other.id, name: "Theirs" } });
  const visibleToFirst = await prisma.savedList.findMany({ where: { organizationId: orgId, archivedAt: null } });
  assert.ok(!visibleToFirst.some((l) => l.id === otherList.id));
  await prisma.savedList.delete({ where: { id: otherList.id } });
  await prisma.organization.delete({ where: { id: other.id } });
});

// ── mixed-list snapshot preserves the list (durability guarantee) ──────────

test("snapshot of a mixed list yields product + title PlanItems and preserves the list", async () => {
  const listId = await freshList();
  await addProductItem(listId, productId);
  await addTitleItem(listId, titleId);
  const reloaded = await prisma.savedList.findUnique({ where: { id: listId }, include: { items: true } });
  const planData = snapshotListToPlanData(reloaded!.items);

  const plan = await prisma.plan.create({
    data: { organizationId: orgId, name: "snap", items: { create: planData } },
    include: { items: true },
  });
  assert.equal(plan.items.length, 2);
  assert.ok(plan.items.some((i) => i.productId === productId && i.titleId === null));
  assert.ok(plan.items.some((i) => i.titleId === titleId && i.productId === null));
  assert.ok(await prisma.savedList.findUnique({ where: { id: listId } })); // durable

  await prisma.planItem.deleteMany({ where: { planId: plan.id } });
  await prisma.plan.delete({ where: { id: plan.id } });
});

// ── resolveActiveList (render-path read-only resolver) ─────────────────────

test("resolveActiveList never creates: returns null when org has no lists", async () => {
  const fresh = await prisma.organization.create({ data: { name: "Empty Org Task10", type: "ADVERTISER", marketCode: "NO" } });
  const r = await resolveActiveList(fresh.id, null);
  assert.equal(r, null);
  assert.equal(await prisma.savedList.count({ where: { organizationId: fresh.id } }), 0); // did NOT create
  await prisma.organization.delete({ where: { id: fresh.id } });
});

test("resolveActiveList falls back to the most-recent non-archived list when cookie is empty", async () => {
  const listId = await freshList();
  await addProductItem(listId, productId);
  const r = await resolveActiveList(orgId, null);
  assert.ok(r);
  assert.equal(r!.organizationId, orgId);
});

test("resolveActiveList ignores a cookie id from another org and falls back", async () => {
  const other = await prisma.organization.create({ data: { name: "Other Org R", type: "ADVERTISER", marketCode: "NO" } });
  const theirs = await prisma.savedList.create({ data: { organizationId: other.id } });
  const r = await resolveActiveList(orgId, theirs.id);
  assert.notEqual(r?.id, theirs.id);
  await prisma.savedList.delete({ where: { id: theirs.id } });
  await prisma.organization.delete({ where: { id: other.id } });
});

// ── rehomeSavedListItems (catalog-merge survivor re-pointing) ───────────────

async function cloneProduct(): Promise<string> {
  const src = await prisma.product.findUnique({ where: { id: productId } });
  const c = await prisma.product.create({
    data: {
      titleId: src!.titleId, type: src!.type, name: src!.name + " (rehome-test)",
      basePrice: src!.basePrice, currency: src!.currency, pricingModel: src!.pricingModel,
      active: true, bookable: true,
    },
  });
  return c.id;
}

test("rehomeSavedListItems re-points a line when the survivor is not already on the list", async () => {
  const dead = await cloneProduct();
  const listId = await freshList();
  const item = await addProductItem(listId, dead);
  const res = await prisma.$transaction((tx) => rehomeSavedListItems(tx, dead, productId));
  assert.deepEqual(res, { moved: 1, merged: 0 });
  const row = await prisma.savedListItem.findUnique({ where: { id: item.id } });
  assert.equal(row!.productId, productId); // followed the survivor, not dropped
  await prisma.product.delete({ where: { id: dead } });
});

test("rehomeSavedListItems merges quantities when the survivor is already on the list", async () => {
  const dead = await cloneProduct();
  const listId = await freshList();
  await addProductItem(listId, productId); // survivor, qty 1
  await prisma.savedListItem.updateMany({ where: { listId, productId }, data: { quantity: 2 } });
  const deadItem = await addProductItem(listId, dead); // dead line, qty 1
  const res = await prisma.$transaction((tx) => rehomeSavedListItems(tx, dead, productId));
  assert.deepEqual(res, { moved: 0, merged: 1 });
  assert.equal(await prisma.savedListItem.findUnique({ where: { id: deadItem.id } }), null); // dead line gone
  const rows = await prisma.savedListItem.findMany({ where: { listId } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 3); // 2 + 1 merged (clamped)
  await prisma.product.delete({ where: { id: dead } });
});
