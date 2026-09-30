import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { runPlacementReadySweep, runPlacementReadySweepWithLock } from "./placement-ready-sweep";
import type { MarketCode } from "@prisma/client";

const RUN_DB_IT = process.env.RUN_DB_IT === "1";

let orgId = "";
let deskUserId = "";
let buyerUserId = "";
let publisherId = "";
let marketCode!: MarketCode;

before(async () => {
  if (!RUN_DB_IT) return;
  const market = await prisma.market.findFirst({ select: { code: true } });
  marketCode = market!.code;
  const org = await prisma.organization.create({
    data: { name: "Placement Sweep IT Org", type: "ADVERTISER", marketCode },
  });
  orgId = org.id;
  const buyer = await prisma.user.create({
    data: { email: `sweep-buyer-${org.id}@example.com`, organizationId: orgId },
  });
  buyerUserId = buyer.id;
  // Org notices go to ACTIVE seats (lib/notify.ts), like access does.
  await prisma.membership.create({ data: { userId: buyer.id, organizationId: orgId, role: "ADMIN", canCommit: true } });
  const desk = await prisma.user.create({
    data: { email: `sweep-desk-${org.id}@example.com`, role: "DESK" },
  });
  deskUserId = desk.id;
  const publisher = await prisma.publisher.findFirst({ select: { id: true } });
  publisherId = publisher!.id;
});

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.notification.deleteMany({ where: { userId: { in: [buyerUserId, deskUserId] } } });
  await prisma.auditLog.deleteMany({ where: { entity: { startsWith: "SavedListItem:" } } });
  await prisma.savedListItem.deleteMany({ where: { list: { organizationId: orgId } } });
  await prisma.savedList.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [buyerUserId, deskUserId] } } });
  await prisma.organization.delete({ where: { id: orgId } });
});

async function freshTitleWithProduct(
  opts: { active?: boolean; bookable?: boolean; confirmed?: boolean } | null,
): Promise<string> {
  const market = await prisma.market.findUnique({ where: { code: marketCode } });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const title = await prisma.title.create({
    data: {
      name: `Sweep Title ${suffix}`,
      slug: `sweep-title-${suffix}`,
      publisherId,
      countryCode: market!.code,
      marketId: market!.id,
      category: "test",
    },
  });
  if (opts) await addProduct(title.id, opts);
  return title.id;
}

async function addProduct(
  titleId: string,
  opts: { active?: boolean; bookable?: boolean; confirmed?: boolean },
): Promise<void> {
  const market = await prisma.market.findUnique({ where: { code: marketCode } });
  await prisma.product.create({
    data: {
      titleId,
      type: "NATIVE_ARTICLE",
      name: "Sweep Test Product",
      basePrice: 1000,
      currency: market!.currency,
      active: opts.active ?? true,
      bookable: opts.bookable ?? true,
      confirmedAt: opts.confirmed === false ? null : new Date(),
    },
  });
}

async function freshList(): Promise<string> {
  const list = await prisma.savedList.create({ data: { organizationId: orgId } });
  return list.id;
}

if (!RUN_DB_IT) {
  test("placement-ready-sweep integration (skipped — set RUN_DB_IT=1)", { skip: true }, () => {});
} else {
  test("notifies buyer + desk once when a placeholder's title gains a bookable product, then stays quiet on rerun", async () => {
    // Placeholder first, THEN the price lands — the "gains" in the name.
    const titleId = await freshTitleWithProduct(null);
    const listId = await freshList();
    const item = await prisma.savedListItem.create({
      // A second before the price lands: the sweep only counts a price that
      // arrived AFTER the placeholder (strictly later), and a fast machine can
      // otherwise stamp both in the same millisecond.
      data: { listId, titleId, createdAt: new Date(Date.now() - 1_000) },
    });
    await addProduct(titleId, { active: true, bookable: true, confirmed: true });

    // The sweep is system-wide and this suite shares its database with every
    // other .it.test.ts file, so its counters are global: assert ">= 1" plus
    // the per-item evidence below, never an exact global count.
    // Each tick is capped (MAX_NOTIFICATIONS_PER_SWEEP); tick until this
    // item's turn, the way production catches up across ticks.
    const notifiedYet = () =>
      prisma.auditLog.findFirst({
        where: { entity: `SavedListItem:${item.id}`, action: "placement-ready.notified" },
      });
    for (let tick = 0; tick < 25 && !(await notifiedYet()); tick++) {
      const res = await runPlacementReadySweep();
      assert.equal(res.failed, 0, "no item failed");
    }
    assert.ok(await notifiedYet(), "the sweep notified this item");

    const buyerNotifs = await prisma.notification.findMany({
      where: { userId: buyerUserId, kind: "TITLE_PRODUCT_READY" },
    });
    assert.equal(buyerNotifs.length, 1);
    assert.ok(buyerNotifs[0].link?.endsWith(`/plan/${listId}`), "link deep-links to the plan's own address");
    // Stored as a template, so /notifications renders it in the reader's language.
    assert.equal(buyerNotifs[0].messageKey, "placementReady");
    assert.deepEqual(buyerNotifs[0].messageParams, {
      titleName: (await prisma.title.findUniqueOrThrow({ where: { id: titleId } })).name,
      listName: (await prisma.savedList.findUniqueOrThrow({ where: { id: listId } })).name,
      listId,
    });

    const deskNotifs = await prisma.notification.findMany({
      where: { userId: deskUserId, kind: "TITLE_PRODUCT_READY" },
    });
    assert.equal(deskNotifs.length, 1);

    const marker = await prisma.auditLog.findFirst({
      where: { entity: `SavedListItem:${item.id}`, action: "placement-ready.notified" },
    });
    assert.ok(marker, "audit marker recorded");

    // Rerun: the marker latch must hold for THIS item. Scoped to this suite's
    // own users, so a concurrent placeholder elsewhere in the shared DB can't
    // make it flap.
    await runPlacementReadySweep();
    assert.equal(
      await prisma.notification.count({ where: { userId: buyerUserId, kind: "TITLE_PRODUCT_READY" } }),
      1,
      "no duplicate notification",
    );
    assert.equal(
      await prisma.notification.count({ where: { userId: deskUserId, kind: "TITLE_PRODUCT_READY" } }),
      1,
      "no duplicate desk notification",
    );
  });

  // BUG-prod-api-18: "Arkitektur har nu ett pris" fired seconds after the
  // buyer added a placeholder for a title that already had a price.
  test("stays quiet for a placeholder added to a title that was already priced", async () => {
    const titleId = await freshTitleWithProduct({ active: true, bookable: true, confirmed: true });
    const listId = await freshList();
    const item = await prisma.savedListItem.create({ data: { listId, titleId } });

    await runPlacementReadySweep();

    assert.equal(
      await prisma.auditLog.count({
        where: { entity: `SavedListItem:${item.id}`, action: "placement-ready.notified" },
      }),
      0,
      "nothing changed since the placeholder was added — no 'now has a price'",
    );
  });

  test("stays quiet when no qualifying product exists (missing / inactive / not bookable / unconfirmed)", async () => {
    const titleNone = await freshTitleWithProduct(null);
    const titleInactive = await freshTitleWithProduct({ active: false });
    const titleNotBookable = await freshTitleWithProduct({ bookable: false });
    const titleUnconfirmed = await freshTitleWithProduct({ confirmed: false });
    const listId = await freshList();
    const items = await Promise.all(
      [titleNone, titleInactive, titleNotBookable, titleUnconfirmed].map((titleId) =>
        prisma.savedListItem.create({ data: { listId, titleId } }),
      ),
    );

    await runPlacementReadySweep();

    // Scoped evidence, not the sweep's global counter: none of THESE items may
    // have been marked notified, and nothing may link to THIS list.
    assert.equal(
      await prisma.auditLog.count({
        where: {
          action: "placement-ready.notified",
          entity: { in: items.map((i) => `SavedListItem:${i.id}`) },
        },
      }),
      0,
      "no marker for a placeholder without a qualifying product",
    );
    assert.equal(
      await prisma.notification.count({
        where: { kind: "TITLE_PRODUCT_READY", link: { endsWith: `/plan/${listId}` } },
      }),
      0,
      "no notification deep-links to this list",
    );
  });

  test("skips placeholders on an archived list (its deep link could not land there)", async () => {
    const titleId = await freshTitleWithProduct({ active: true, bookable: true, confirmed: true });
    const list = await prisma.savedList.create({
      data: { organizationId: orgId, archivedAt: new Date() },
    });
    const item = await prisma.savedListItem.create({ data: { listId: list.id, titleId } });

    await runPlacementReadySweep();

    const marker = await prisma.auditLog.findFirst({
      where: { entity: `SavedListItem:${item.id}`, action: "placement-ready.notified" },
    });
    assert.equal(marker, null, "archived list is not swept");
    assert.equal(
      await prisma.notification.count({
        where: { kind: "TITLE_PRODUCT_READY", link: { contains: `list=${list.id}` } },
      }),
      0,
      "no notification deep-links to the archived list",
    );
  });

  test("runPlacementReadySweepWithLock delegates to the sweep when uncontended", async () => {
    const titleId = await freshTitleWithProduct(null);
    const listId = await freshList();
    const item = await prisma.savedListItem.create({
      // A second before the price lands: the sweep only counts a price that
      // arrived AFTER the placeholder (strictly later), and a fast machine can
      // otherwise stamp both in the same millisecond.
      data: { listId, titleId, createdAt: new Date(Date.now() - 1_000) },
    });
    await addProduct(titleId, { active: true, bookable: true, confirmed: true });

    // Each tick is capped (MAX_NOTIFICATIONS_PER_SWEEP), and other suites'
    // leftover placeholders in a shared DB can fill a tick, so tick through
    // the locked path until this item's turn, the way production catches up.
    const findMarker = () =>
      prisma.auditLog.findFirst({
        where: { entity: `SavedListItem:${item.id}`, action: "placement-ready.notified" },
      });
    let marker = null;
    for (let tick = 0; tick < 25 && !marker; tick++) {
      const res = await runPlacementReadySweepWithLock();
      assert.ok(res, "lock was acquired and the sweep ran");
      marker = await findMarker();
    }
    assert.ok(marker, "this item was notified through the locked path");
  });
}
