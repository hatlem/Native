import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureActiveList, addProductItem, setItemQuantity } from "./lists";
import {
  approvalState,
  approveSharedList,
  enableListShare,
  disableListShare,
  loadSharedList,
  planVersion,
} from "./list-share";

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

  test("client approval covers one version: stale after a line change, cleared by a new link", async () => {
    const list = await prisma.savedList.create({ data: { organizationId: orgId, name: "Approval IT" } });
    const item = await addProductItem(list.id, productId);
    const token = await enableListShare(list.id);
    const shown = await loadSharedList(token);
    const version = planVersion(shown!.items);

    // A version the page never showed approves nothing.
    assert.deepEqual(await approveSharedList(token, "not-the-shown-version"), { outcome: "changed" });

    const first = await approveSharedList(token, version);
    assert.equal(first.outcome, "approved");
    // Double click / second tab: no second approval (and no second notice).
    assert.deepEqual(await approveSharedList(token, version), { outcome: "already" });
    let row = await prisma.savedList.findUniqueOrThrow({ where: { id: list.id } });
    assert.equal(approvalState(row, version).kind, "current");

    // The buyer changes a line after approval: the approval is for an earlier
    // version ("approved before changes"), and the client can approve again.
    await setItemQuantity(item.id, 3);
    const changed = planVersion((await loadSharedList(token))!.items);
    assert.notEqual(changed, version);
    row = await prisma.savedList.findUniqueOrThrow({ where: { id: list.id } });
    assert.equal(approvalState(row, changed).kind, "stale");
    // Approving from a page loaded BEFORE the change is refused.
    assert.deepEqual(await approveSharedList(token, version), { outcome: "changed" });
    assert.equal((await approveSharedList(token, changed)).outcome, "approved");
    row = await prisma.savedList.findUniqueOrThrow({ where: { id: list.id } });
    assert.equal(approvalState(row, changed).kind, "current");

    // A new link starts a new review round.
    await enableListShare(list.id);
    row = await prisma.savedList.findUniqueOrThrow({ where: { id: list.id } });
    assert.equal(row.clientApprovedAt, null);
    assert.equal(approvalState(row, changed).kind, "none");
  });

  test("an approval goes stale when the line dates or the customer note change", async () => {
    const list = await prisma.savedList.create({ data: { organizationId: orgId, name: "Approval dates IT" } });
    const item = await addProductItem(list.id, productId);
    const token = await enableListShare(list.id);
    const approve = async () => {
      const v = planVersion((await loadSharedList(token))!.items);
      assert.equal((await approveSharedList(token, v)).outcome, "approved");
      return v;
    };
    const stateNow = async () => {
      const row = await prisma.savedList.findUniqueOrThrow({ where: { id: list.id } });
      return approvalState(row, planVersion((await loadSharedList(token))!.items)).kind;
    };

    await approve();
    // The share page shows the run: setting dates is a change to approve.
    await prisma.savedListItem.update({
      where: { id: item.id },
      data: { scheduleStart: new Date("2026-10-01T00:00:00Z"), scheduleUnits: 1 },
    });
    assert.equal(await stateNow(), "stale", "dates set after approval");
    await approve();
    await prisma.savedListItem.update({ where: { id: item.id }, data: { scheduleUnits: 2 } });
    assert.equal(await stateNow(), "stale", "run length changed after approval");
    await approve();
    await prisma.savedListItem.update({ where: { id: item.id }, data: { notes: "Next to the match report" } });
    assert.equal(await stateNow(), "stale", "customer note changed after approval");
    await approve();
    assert.equal(await stateNow(), "current");
  });

  test("planVersion ignores alternatives and line order", async () => {
    const list = await prisma.savedList.create({ data: { organizationId: orgId, name: "Version IT" } });
    await addProductItem(list.id, productId);
    const items = await prisma.savedListItem.findMany({ where: { listId: list.id } });
    const base = planVersion(items);
    assert.equal(planVersion([...items].reverse()), base);
    assert.equal(
      planVersion([...items, { ...items[0], id: "alt", isAlternative: true }]),
      base,
      "an alternative is not part of what the client approves",
    );
  });

  test("an approval from before versioning reads as stale, and the client can approve again", async () => {
    const list = await prisma.savedList.create({
      data: { organizationId: orgId, name: "Legacy approval IT", clientApprovedAt: new Date("2026-09-01T10:00:00Z") },
    });
    await addProductItem(list.id, productId);
    const token = await enableListShare(list.id);
    // enableListShare starts a new review round; restore the legacy state.
    await prisma.savedList.update({
      where: { id: list.id },
      data: { clientApprovedAt: new Date("2026-09-01T10:00:00Z"), clientApprovedVersion: null },
    });
    const shown = await loadSharedList(token);
    const version = planVersion(shown!.items);
    let row = await prisma.savedList.findUniqueOrThrow({ where: { id: list.id } });
    assert.equal(approvalState(row, version).kind, "stale");
    assert.equal((await approveSharedList(token, version)).outcome, "approved");
    row = await prisma.savedList.findUniqueOrThrow({ where: { id: list.id } });
    assert.equal(approvalState(row, version).kind, "current");
  });
}
