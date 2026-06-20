import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import {
  toggleFavorite,
  addFavoriteToList,
  removeFavoriteFromList,
  removeFavoriteFromListByTitle,
  createFavoriteList,
  renameFavoriteList,
  deleteFavoriteList,
  setFavoriteListShared,
  getFavoritedTitleIds,
  getListMembershipForTitles,
  getFavoritesOverview,
} from "./favorites";

// Gated like favorites.flow.it.test.ts: these mutate the configured DB, so they
// only run when RUN_DB_IT=1 (CI). `pnpm test:it` without it must not touch the DB.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

let orgId = "";
let otherOrgId = "";
let userId = "";
let mateId = "";
let outsiderId = "";
let titleId = "";
let titleId2 = "";

before(async () => {
  if (!RUN_DB_IT) return;
  const market = await prisma.market.findFirst();
  const code = market?.code ?? "NO";
  const org = await prisma.organization.create({ data: { name: "Fav IT Org", type: "AGENCY", marketCode: code } });
  const other = await prisma.organization.create({ data: { name: "Fav IT Other", type: "AGENCY", marketCode: code } });
  orgId = org.id;
  otherOrgId = other.id;
  const u = await prisma.user.create({ data: { email: `fav-it-${org.id}@example.com`, organizationId: orgId } });
  const m = await prisma.user.create({ data: { email: `fav-it-mate-${org.id}@example.com`, organizationId: orgId } });
  const o = await prisma.user.create({ data: { email: `fav-it-out-${org.id}@example.com`, organizationId: otherOrgId } });
  userId = u.id; mateId = m.id; outsiderId = o.id;
  const titles = await prisma.title.findMany({ where: { active: true }, select: { id: true }, take: 2 });
  titleId = titles[0].id;
  titleId2 = titles[1].id;
});

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.favoriteList.deleteMany({ where: { userId: { in: [userId, mateId, outsiderId] } } });
  await prisma.favorite.deleteMany({ where: { userId: { in: [userId, mateId, outsiderId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, mateId, outsiderId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
});

test("toggleFavorite is idempotent: hearts once, then removes", { skip: !RUN_DB_IT }, async () => {
  const a = await toggleFavorite(userId, titleId);
  assert.equal(a.favorited, true);
  assert.equal(await prisma.favorite.count({ where: { userId, titleId } }), 1);
  const b = await toggleFavorite(userId, titleId);
  assert.equal(b.favorited, false);
  assert.equal(await prisma.favorite.count({ where: { userId, titleId } }), 0);
});

test("toggleFavorite on an unknown title is a no-op", { skip: !RUN_DB_IT }, async () => {
  const r = await toggleFavorite(userId, "does-not-exist");
  assert.equal(r.favorited, false);
});

test("addFavoriteToList auto-creates the Favorite when missing and is idempotent", { skip: !RUN_DB_IT }, async () => {
  const list = await createFavoriteList(userId, orgId, "B2B picks");
  await addFavoriteToList(userId, titleId, list.id);
  const fav = await prisma.favorite.findUnique({ where: { userId_titleId: { userId, titleId } } });
  assert.ok(fav, "favorite created");
  assert.equal(await prisma.favoriteListItem.count({ where: { listId: list.id } }), 1);
  await addFavoriteToList(userId, titleId, list.id);
  assert.equal(await prisma.favoriteListItem.count({ where: { listId: list.id } }), 1);
});

test("un-hearting a title cascades it out of every list", { skip: !RUN_DB_IT }, async () => {
  const list = await createFavoriteList(userId, orgId, "Cascade list");
  await addFavoriteToList(userId, titleId2, list.id);
  assert.equal(await prisma.favoriteListItem.count({ where: { listId: list.id } }), 1);
  await toggleFavorite(userId, titleId2); // un-heart (currently favorited)
  assert.equal(await prisma.favorite.count({ where: { userId, titleId: titleId2 } }), 0);
  assert.equal(await prisma.favoriteListItem.count({ where: { listId: list.id } }), 0);
});

test("removeFavoriteFromList drops the membership but keeps the heart", { skip: !RUN_DB_IT }, async () => {
  const list = await createFavoriteList(userId, orgId, "Keep heart");
  await addFavoriteToList(userId, titleId, list.id);
  const fav = await prisma.favorite.findUnique({ where: { userId_titleId: { userId, titleId } }, select: { id: true } });
  await removeFavoriteFromList(userId, list.id, fav!.id);
  assert.equal(await prisma.favoriteListItem.count({ where: { listId: list.id } }), 0);
  assert.equal(await prisma.favorite.count({ where: { userId, titleId } }), 1);
  await toggleFavorite(userId, titleId); // clean up
});

test("list mutations reject a non-owner", { skip: !RUN_DB_IT }, async () => {
  const list = await createFavoriteList(userId, orgId, "Owner only");
  await assert.rejects(() => renameFavoriteList(mateId, list.id, "hijack"));
  await assert.rejects(() => deleteFavoriteList(mateId, list.id));
  await assert.rejects(() => setFavoriteListShared(mateId, list.id, true));
});

test("shared lists are visible to same-org mates, not outsiders, not under owner's shared", { skip: !RUN_DB_IT }, async () => {
  const list = await createFavoriteList(userId, orgId, "Shared picks");
  await addFavoriteToList(userId, titleId, list.id);
  await setFavoriteListShared(userId, list.id, true);
  const mateView = await getFavoritesOverview(mateId, orgId);
  assert.ok(mateView.sharedLists.some((l) => l.id === list.id), "mate sees shared list");
  const outsiderView = await getFavoritesOverview(outsiderId, otherOrgId);
  assert.ok(!outsiderView.sharedLists.some((l) => l.id === list.id), "outsider does not");
  const ownerView = await getFavoritesOverview(userId, orgId);
  assert.ok(ownerView.lists.some((l) => l.id === list.id));
  assert.ok(!ownerView.sharedLists.some((l) => l.id === list.id));
  await toggleFavorite(userId, titleId); // clean up
});

test("getFavoritedTitleIds returns only this user's hearts for the given titles", { skip: !RUN_DB_IT }, async () => {
  await toggleFavorite(userId, titleId); // heart it
  const ids = await getFavoritedTitleIds(userId, [titleId, titleId2]);
  assert.ok(ids.has(titleId));
  assert.ok(!ids.has(titleId2));
  await toggleFavorite(userId, titleId); // clean up
});

test("the same publication can live in multiple lists; membership map + per-title removal track it", { skip: !RUN_DB_IT }, async () => {
  const listA = await createFavoriteList(userId, orgId, "Multi A");
  const listB = await createFavoriteList(userId, orgId, "Multi B");

  // Same title into BOTH lists — one Favorite row, two memberships.
  await addFavoriteToList(userId, titleId, listA.id);
  await addFavoriteToList(userId, titleId, listB.id);
  assert.equal(await prisma.favorite.count({ where: { userId, titleId } }), 1, "one favorite row");

  const membership = await getListMembershipForTitles(userId, [titleId]);
  assert.deepEqual(
    [...(membership[titleId] ?? [])].sort(),
    [listA.id, listB.id].sort(),
    "title reports membership in both lists",
  );

  // Remove from list A by title — still in B, heart kept.
  await removeFavoriteFromListByTitle(userId, titleId, listA.id);
  const after = await getListMembershipForTitles(userId, [titleId]);
  assert.deepEqual(after[titleId], [listB.id], "only list B remains");
  assert.equal(await prisma.favorite.count({ where: { userId, titleId } }), 1, "heart kept");

  await toggleFavorite(userId, titleId); // clean up the heart (cascades remaining membership)
});

test("getListMembershipForTitles is isolated per user (no cross-user leak)", { skip: !RUN_DB_IT }, async () => {
  const mine = await createFavoriteList(userId, orgId, "Mine");
  const theirs = await createFavoriteList(mateId, orgId, "Theirs");
  await addFavoriteToList(userId, titleId, mine.id);
  await addFavoriteToList(mateId, titleId, theirs.id); // SAME title, different user
  const map = await getListMembershipForTitles(userId, [titleId]);
  assert.deepEqual(map[titleId], [mine.id], "only my list — never the teammate's");
  // and the teammate sees only theirs
  const mateMap = await getListMembershipForTitles(mateId, [titleId]);
  assert.deepEqual(mateMap[titleId], [theirs.id]);
  await toggleFavorite(userId, titleId);
  await toggleFavorite(mateId, titleId);
  await prisma.favoriteList.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
});

test("a favorite whose title is later deactivated is hidden from the overview", { skip: !RUN_DB_IT }, async () => {
  const market = await prisma.market.findFirst();
  const publisher = await prisma.publisher.findFirst();
  const tmp = await prisma.title.create({
    data: {
      name: "Fav IT Temp Title",
      slug: `fav-it-temp-${userId}`,
      publisherId: publisher!.id,
      countryCode: market!.code,
      marketId: market!.id,
      category: "business",
      active: true,
    },
  });
  try {
    await toggleFavorite(userId, tmp.id);
    const whileActive = await getFavoritesOverview(userId, orgId);
    assert.ok(
      whileActive.favorites.some((f) => f.titleId === tmp.id),
      "shows while the title is active",
    );

    await prisma.title.update({ where: { id: tmp.id }, data: { active: false } });
    const whenInactive = await getFavoritesOverview(userId, orgId);
    assert.ok(
      !whenInactive.favorites.some((f) => f.titleId === tmp.id),
      "hidden once the title is deactivated",
    );
  } finally {
    await prisma.favorite.deleteMany({ where: { userId, titleId: tmp.id } });
    await prisma.title.delete({ where: { id: tmp.id } }).catch(() => {});
  }
});
