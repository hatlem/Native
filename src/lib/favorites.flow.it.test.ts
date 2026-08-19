import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import {
  toggleFavorite,
  addFavoriteToList,
  removeFavoriteFromList,
  createFavoriteList,
  setFavoriteListShared,
  getFavoritesOverview,
  getFavoriteListDetail,
} from "./favorites";

// End-to-end of the favorites journey, driven at the lib layer (the server
// actions require an auth session + revalidatePath, so they can't be called
// directly — same approach as lists.flow.it.test.ts). Covers the access-control
// surface getFavoriteListDetail enforces: owner sees their list, a same-org
// teammate sees a SHARED list, an outsider is denied. Gated behind RUN_DB_IT.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

let orgId = "";
let otherOrgId = "";
let buyerId = "";
let mateId = "";
let outsiderId = "";
let titleA = "";
let titleB = "";

before(async () => {
  if (!RUN_DB_IT) return;
  const market = await prisma.market.findFirst();
  const code = market?.code ?? "NO";
  const org = await prisma.organization.create({ data: { name: "Fav Flow Org", type: "AGENCY", marketCode: code } });
  const other = await prisma.organization.create({ data: { name: "Fav Flow Other", type: "AGENCY", marketCode: code } });
  orgId = org.id;
  otherOrgId = other.id;
  const buyer = await prisma.user.create({ data: { email: `fav-flow-${org.id}@example.com`, organizationId: orgId } });
  const mate = await prisma.user.create({ data: { email: `fav-flow-mate-${org.id}@example.com`, organizationId: orgId } });
  const out = await prisma.user.create({ data: { email: `fav-flow-out-${org.id}@example.com`, organizationId: otherOrgId } });
  buyerId = buyer.id; mateId = mate.id; outsiderId = out.id;
  const titles = await prisma.title.findMany({ where: { active: true }, select: { id: true }, take: 2 });
  titleA = titles[0].id;
  titleB = titles[1].id;
});

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.favoriteList.deleteMany({ where: { userId: { in: [buyerId, mateId, outsiderId] } } });
  await prisma.favorite.deleteMany({ where: { userId: { in: [buyerId, mateId, outsiderId] } } });
  // notifyDesk/notifyOrg from parallel suites can stamp Notification rows on
  // transient test users mid-run — clear them or the user delete FK-faults.
  await prisma.notification.deleteMany({ where: { user: { id: { in: [buyerId, mateId, outsiderId] } } } });
  await prisma.user.deleteMany({ where: { id: { in: [buyerId, mateId, outsiderId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
});

test("buyer hearts publications, builds + shares a list, teammate sees it, then tears it down", async (t) => {
  if (!RUN_DB_IT) return t.skip("RUN_DB_IT not set");

  // 1) Heart two publications.
  await toggleFavorite(buyerId, titleA);
  await toggleFavorite(buyerId, titleB);

  // 2) Build a list with A and share it.
  const list = await createFavoriteList(buyerId, orgId, "Q3 shortlist");
  await addFavoriteToList(buyerId, titleA, list.id);
  await setFavoriteListShared(buyerId, list.id, true);

  // 3) Buyer's overview: both hearts present; the list shows under their own lists, shared.
  const buyerOverview = await getFavoritesOverview(buyerId, orgId);
  assert.equal(buyerOverview.favorites.length, 2);
  const ownList = buyerOverview.lists.find((l) => l.id === list.id);
  assert.ok(ownList && ownList.sharedWithOrg && ownList.itemCount === 1);

  // 4) Owner detail view: isOwner true, item A present.
  const ownerDetail = await getFavoriteListDetail(buyerId, orgId, list.id);
  assert.ok(ownerDetail && ownerDetail.isOwner);
  assert.deepEqual(ownerDetail.items.map((i) => i.titleId), [titleA]);

  // 5) Same-org teammate: sees it under sharedLists; detail is read-only (isOwner false).
  const mateOverview = await getFavoritesOverview(mateId, orgId);
  assert.ok(mateOverview.sharedLists.some((l) => l.id === list.id));
  const mateDetail = await getFavoriteListDetail(mateId, orgId, list.id);
  assert.ok(mateDetail && !mateDetail.isOwner);
  assert.deepEqual(mateDetail.items.map((i) => i.titleId), [titleA]);

  // 6) Outsider in another org is denied the detail entirely.
  const outsiderDetail = await getFavoriteListDetail(outsiderId, otherOrgId, list.id);
  assert.equal(outsiderDetail, null);

  // 7) Removing A from the list keeps the heart (still in the flat pool).
  await removeFavoriteFromList(buyerId, list.id, ownerDetail.items[0].favoriteId);
  const afterRemove = await getFavoriteListDetail(buyerId, orgId, list.id);
  assert.equal(afterRemove!.items.length, 0);
  const stillHearted = await getFavoritesOverview(buyerId, orgId);
  assert.equal(stillHearted.favorites.length, 2);

  // 8) Un-hearting both empties the pool.
  await toggleFavorite(buyerId, titleA);
  await toggleFavorite(buyerId, titleB);
  const cleared = await getFavoritesOverview(buyerId, orgId);
  assert.equal(cleared.favorites.length, 0);
});
