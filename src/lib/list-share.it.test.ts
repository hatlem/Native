import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureActiveList, addProductItem } from "./lists";
import { enableListShare, disableListShare, loadSharedList } from "./list-share";

// Client-share links at the lib layer (server actions need a session — same
// convention as the other *.it suites). The invariants a public, unauthenticated
// surface lives or dies by: only a real token resolves, disable kills the link,
// re-enable mints a DIFFERENT token (old circulating links stay dead), and
// archiving the list is an implicit revoke.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

let orgId = "";
let productId = "";

before(async () => {
  if (!RUN_DB_IT) return;
  const market = await prisma.market.findFirst();
  const org = await prisma.organization.create({
    data: { name: "Share IT Org", type: "ADVERTISER", marketCode: market?.code ?? "NO" },
  });
  orgId = org.id;
  const product = await prisma.product.findFirst({
    where: { active: true, bookable: true },
    select: { id: true },
  });
  productId = product!.id;
});

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.savedListItem.deleteMany({ where: { list: { organizationId: orgId } } });
  await prisma.savedList.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
});

if (!RUN_DB_IT) {
  test("list-share integration (skipped — set RUN_DB_IT=1)", { skip: true }, () => {});
} else {
  test("share lifecycle: enable resolves, re-enable rotates, disable and archive revoke", async () => {
    const list = await ensureActiveList(orgId, null);
    await addProductItem(list.id, productId);

    // No token → nothing resolves, and junk never matches.
    assert.equal(await loadSharedList(""), null);
    assert.equal(await loadSharedList("short"), null);
    assert.equal(await loadSharedList("x".repeat(43)), null);

    const token = await enableListShare(list.id);
    assert.ok(token.length >= 40, "256-bit base64url token");
    const shared = await loadSharedList(token);
    assert.equal(shared?.id, list.id);
    assert.equal(shared?.items.length, 1);
    assert.equal(shared?.organization.name, "Share IT Org");

    // Re-enable rotates: the OLD link must die the moment a new one exists.
    const rotated = await enableListShare(list.id);
    assert.notEqual(rotated, token);
    assert.equal(await loadSharedList(token), null, "old token dead after rotation");
    assert.equal((await loadSharedList(rotated))?.id, list.id);

    // Disable revokes.
    await disableListShare(list.id);
    assert.equal(await loadSharedList(rotated), null, "disabled token dead");

    // Archive is an implicit revoke even while a token exists.
    const again = await enableListShare(list.id);
    await prisma.savedList.update({ where: { id: list.id }, data: { archivedAt: new Date() } });
    assert.equal(await loadSharedList(again), null, "archived list never renders");
  });
}
