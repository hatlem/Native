import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureActiveList, addProductItem, addTitleItem, resolveTitleItem } from "./lists";

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
