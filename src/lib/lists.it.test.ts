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
  setItemContent,
  migrateLegacyBasket,
  snapshotListToPlanData,
} from "./lists";
import { rehomeSavedListItems } from "./commerce/rehome-saved-list-items";
import { catalogVisibleTitleWhere } from "./catalog-visibility";
import { toggleFavorite } from "./favorites";
import { canActOnOrg, type Scope } from "./scope";

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

// ── "We write it" drives authorshipMode on every write path ─────────────────
// The RFQ snapshot, the content-fee lines and writer staffing all read
// authorshipMode; before, only withContent was written, so an RFQ plan with
// "Vi skriver den" pressed produced no fee and an unstaffable order line.

async function pair(id: string) {
  const row = await prisma.savedListItem.findUnique({
    where: { id },
    select: { withContent: true, authorshipMode: true },
  });
  return row;
}

test("addProductItem with content stores NATIVESPIN_PRODUCED", async () => {
  const listId = await freshList();
  const item = await addProductItem(listId, productId, true);
  assert.deepEqual(await pair(item.id), { withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" });
});

test("re-adding with content turns content on; a plain re-add never turns it off", async () => {
  const listId = await freshList();
  const item = await addProductItem(listId, productId);
  assert.deepEqual(await pair(item.id), { withContent: false, authorshipMode: "BUYER_SUPPLIED" });
  await addProductItem(listId, productId, true);
  assert.deepEqual(await pair(item.id), { withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" });
  await addProductItem(listId, productId);
  assert.deepEqual(await pair(item.id), { withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" });
});

test("setItemContent toggles the pair both ways", async () => {
  const listId = await freshList();
  const item = await addProductItem(listId, productId);
  await setItemContent(item.id, true);
  assert.deepEqual(await pair(item.id), { withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" });
  await setItemContent(item.id, false);
  assert.deepEqual(await pair(item.id), { withContent: false, authorshipMode: "BUYER_SUPPLIED" });
});

test("setItemContent off leaves a publisher-produced line alone", async () => {
  const listId = await freshList();
  const item = await addProductItem(listId, productId);
  await prisma.savedListItem.update({ where: { id: item.id }, data: { authorshipMode: "PUBLISHER_PRODUCED" } });
  await setItemContent(item.id, false);
  assert.deepEqual(await pair(item.id), { withContent: false, authorshipMode: "PUBLISHER_PRODUCED" });
});

test("the RFQ snapshot of a toggled line carries NativeSpin authorship", async () => {
  const listId = await freshList();
  const item = await addProductItem(listId, productId);
  await setItemContent(item.id, true);
  const rows = await prisma.savedListItem.findMany({ where: { listId } });
  const [snap] = snapshotListToPlanData(rows);
  assert.equal(snap.withContent, true);
  assert.equal(snap.authorshipMode, "NATIVESPIN_PRODUCED");
});

test("resolving a placeholder onto a line keeps the placeholder's content request", async () => {
  const listId = await freshList();
  const productLine = await addProductItem(listId, productId);
  const placeholder = await addTitleItem(listId, titleId);
  await setItemContent(placeholder.id, true);
  const merged = await resolveTitleItem(placeholder.id, productId);
  assert.equal(merged!.id, productLine.id);
  assert.deepEqual(await pair(productLine.id), { withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" });
});

test("rehomeSavedListItems carries the dead line's content request onto the survivor", async () => {
  const dead = await cloneProduct();
  const listId = await freshList();
  const survivor = await addProductItem(listId, productId);
  await addProductItem(listId, dead, true);
  await prisma.$transaction((tx) => rehomeSavedListItems(tx, dead, productId));
  assert.deepEqual(await pair(survivor.id), { withContent: true, authorshipMode: "NATIVESPIN_PRODUCED" });
  await prisma.product.delete({ where: { id: dead } });
});

test("migrateLegacyBasket derives authorship from the cookie's withContent", async () => {
  const market = await prisma.market.findFirst();
  const org = await prisma.organization.create({
    data: { name: "Legacy authorship IT", type: "ADVERTISER", marketCode: market?.code ?? "NO" },
  });
  const list = await migrateLegacyBasket(org.id, [{ productId, quantity: 1, withContent: true }], null);
  const [row] = await prisma.savedListItem.findMany({ where: { listId: list!.id } });
  assert.equal(row.authorshipMode, "NATIVESPIN_PRODUCED");
  await prisma.savedList.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

// ── catalog "add to list" popover + favorites guard swap ───────────────────
// list-actions.ts's setListTitleMembership/createListWithTitle and
// favorites.ts's toggleFavorite etc. all now gate on catalogVisibleTitleWhere
// instead of a bare `active: true`, so hearting/listing a catalog-visible but
// UNVERIFIED research title (active:false, lastVerifiedAt:null) — exactly the
// "dead first click" bug's trigger — persists instead of silently no-opping.
// The server actions themselves call loadScope() (next-auth session), which
// this DB-only harness can't drive, so these tests exercise the exact guard
// fragment / query / DB semantics those actions are built from.

let researchTitleId = "";
let discontinuedTitleId = "";
let favUserId = "";

before(async () => {
  const seed = await prisma.title.findFirst({ where: { products: { some: {} } } });
  const research = await prisma.title.create({
    data: {
      name: "IT Unverified Research Title",
      slug: `it-unverified-research-${Date.now()}`,
      publisherId: seed!.publisherId,
      countryCode: seed!.countryCode,
      marketId: seed!.marketId,
      category: "trade-press",
      active: false,
      lastVerifiedAt: null,
    },
  });
  researchTitleId = research.id;
  const discontinued = await prisma.title.create({
    data: {
      name: "IT Discontinued Title",
      slug: `it-discontinued-${Date.now()}`,
      publisherId: seed!.publisherId,
      countryCode: seed!.countryCode,
      marketId: seed!.marketId,
      category: "trade-press",
      active: true,
      discontinuedAt: new Date(),
    },
  });
  discontinuedTitleId = discontinued.id;
  const user = await prisma.user.create({ data: { email: `lists-it-fav-${Date.now()}@nativespin.test` } });
  favUserId = user.id;
});

after(async () => {
  await prisma.favorite.deleteMany({ where: { userId: favUserId } });
  await prisma.user.delete({ where: { id: favUserId } });
  await prisma.savedListItem.deleteMany({ where: { titleId: { in: [researchTitleId, discontinuedTitleId] } } });
  await prisma.title.delete({ where: { id: researchTitleId } });
  await prisma.title.delete({ where: { id: discontinuedTitleId } });
});

test("catalogVisibleTitleWhere matches an unverified (active:false, lastVerifiedAt:null) research title", async () => {
  const found = await prisma.title.findFirst({
    where: { id: researchTitleId, ...catalogVisibleTitleWhere },
    select: { id: true },
  });
  assert.ok(found, "the shared guard must surface titles the catalog itself shows");
});

test("catalogVisibleTitleWhere excludes a discontinued title even though active:true", async () => {
  const found = await prisma.title.findFirst({
    where: { id: discontinuedTitleId, ...catalogVisibleTitleWhere },
    select: { id: true },
  });
  assert.equal(found, null);
});

test("setListTitleMembership add-flow: guard passes and addTitleItem is idempotent for a research title (regression for the dead-heart/dead-click bug)", async () => {
  const listId = await freshList();
  const guarded = await prisma.title.findFirst({
    where: { id: researchTitleId, ...catalogVisibleTitleWhere },
    select: { id: true },
  });
  assert.ok(guarded, "the old active:true-only guard would have rejected this title and silently no-opped");
  const a = await addTitleItem(listId, guarded!.id);
  const b = await addTitleItem(listId, guarded!.id); // double add via the checklist
  assert.equal(a.id, b.id);
  assert.equal(await prisma.savedListItem.count({ where: { listId, titleId: researchTitleId } }), 1);
});

test("setListTitleMembership remove-flow: deletes both a title placeholder row and a product-line row of the same title", async () => {
  const listId = await freshList();
  await addTitleItem(listId, titleId); // placeholder row
  await addProductItem(listId, productId); // productId belongs to titleId (see `before`)
  assert.equal(await prisma.savedListItem.count({ where: { listId } }), 2);
  await prisma.savedListItem.deleteMany({
    where: { listId, OR: [{ titleId }, { product: { titleId } }] },
  });
  assert.equal(await prisma.savedListItem.count({ where: { listId } }), 0);
});

test("canActOnOrg rejects a listId belonging to another org (the guard setListTitleMembership/createListWithTitle rely on)", async () => {
  const other = await prisma.organization.create({
    data: { name: "Other Org Membership Guard", type: "ADVERTISER", marketCode: "NO" },
  });
  const theirList = await prisma.savedList.create({ data: { organizationId: other.id } });
  const scope: Scope = {
    session: null,
    role: "BUYER",
    userId: "it-test-user",
    isDesk: false,
    isPublisher: false,
    workspace: {
      userId: "it-test-user",
      isAgency: false,
      agencyOrgId: null,
      homeOrgId: orgId,
      homeRole: null,
      activeOrgId: orgId,
      scopeOrgIds: [orgId],
      commitOrgIds: [orgId],
      activeRole: null,
      activeCanCommit: true,
    },
  };
  assert.equal(canActOnOrg(scope, theirList.organizationId), false, "must not be able to act on another org's list");
  assert.equal(canActOnOrg(scope, orgId), true, "must still be able to act on its own scoped org");
  await prisma.savedList.delete({ where: { id: theirList.id } });
  await prisma.organization.delete({ where: { id: other.id } });
});

test("toggleFavorite hearts an unverified research title (regression for the dead-heart bug)", async () => {
  const first = await toggleFavorite(favUserId, researchTitleId);
  assert.equal(first.favorited, true, "the old active:true-only guard would have returned favorited:false");
  assert.ok(await prisma.favorite.findUnique({ where: { userId_titleId: { userId: favUserId, titleId: researchTitleId } } }));
  const second = await toggleFavorite(favUserId, researchTitleId); // un-heart
  assert.equal(second.favorited, false);
});

test("toggleFavorite still no-ops on a discontinued title", async () => {
  const result = await toggleFavorite(favUserId, discontinuedTitleId);
  assert.equal(result.favorited, false);
  assert.equal(
    await prisma.favorite.findUnique({ where: { userId_titleId: { userId: favUserId, titleId: discontinuedTitleId } } }),
    null,
  );
});

// ── "Sist endret": line changes bump the list (DB trigger) ────────────────

test("every line change moves the list's updatedAt (add, edit, alternative, remove)", async () => {
  const listId = await freshList();
  const stale = new Date("2020-01-01T00:00:00Z");
  const age = () => prisma.savedList.update({ where: { id: listId }, data: { updatedAt: stale } });
  const touched = async (what: string) => {
    const { updatedAt } = await prisma.savedList.findUniqueOrThrow({ where: { id: listId }, select: { updatedAt: true } });
    assert.ok(updatedAt > stale, `${what} must bump SavedList.updatedAt`);
  };

  await age();
  const item = await addProductItem(listId, productId);
  await touched("adding a line");

  await age();
  await prisma.savedListItem.update({ where: { id: item.id }, data: { isAlternative: true } });
  await touched("moving a line to alternatives");

  await age();
  await prisma.savedListItem.update({ where: { id: item.id }, data: { notes: "Merknad" } });
  await touched("editing a note");

  await age();
  await prisma.savedListItem.delete({ where: { id: item.id } });
  await touched("removing a line");

  await prisma.savedList.delete({ where: { id: listId } });
});

test("deleting a list with lines still cascades (trigger tolerates the parent going away)", async () => {
  const listId = await freshList();
  await addProductItem(listId, productId);
  await prisma.savedList.delete({ where: { id: listId } });
  assert.equal(await prisma.savedListItem.count({ where: { listId } }), 0);
});

test("the line-change trigger stamps UTC, not the session time zone", async () => {
  const listId = await freshList();
  // SET LOCAL scopes the zone to this transaction's connection, which is the
  // one the trigger fires on.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`); // UTC+14
    await tx.savedListItem.create({ data: { listId, productId, quantity: 1 } });
  });
  const { updatedAt } = await prisma.savedList.findUniqueOrThrow({ where: { id: listId }, select: { updatedAt: true } });
  const skewMin = Math.abs(updatedAt.getTime() - Date.now()) / 60_000;
  assert.ok(skewMin < 5, `updatedAt is ${Math.round(skewMin)} min off now`);
  await prisma.savedList.delete({ where: { id: listId } });
});
