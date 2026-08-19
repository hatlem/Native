import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { runPlacementReadySweep } from "./placement-ready-sweep";
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
  if (opts) {
    await prisma.product.create({
      data: {
        titleId: title.id,
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
  return title.id;
}

async function freshList(): Promise<string> {
  const list = await prisma.savedList.create({ data: { organizationId: orgId } });
  return list.id;
}

if (!RUN_DB_IT) {
  test("placement-ready-sweep integration (skipped — set RUN_DB_IT=1)", { skip: true }, () => {});
} else {
  test("notifies buyer + desk once when a placeholder's title gains a bookable product, then stays quiet on rerun", async () => {
    const titleId = await freshTitleWithProduct({ active: true, bookable: true, confirmed: true });
    const listId = await freshList();
    const item = await prisma.savedListItem.create({ data: { listId, titleId } });

    const first = await runPlacementReadySweep();
    assert.equal(first.notified, 1);

    const buyerNotifs = await prisma.notification.findMany({
      where: { userId: buyerUserId, kind: "TITLE_PRODUCT_READY" },
    });
    assert.equal(buyerNotifs.length, 1);
    assert.ok(buyerNotifs[0].link?.includes(`list=${listId}`), "link deep-links to the list");

    const deskNotifs = await prisma.notification.findMany({
      where: { userId: deskUserId, kind: "TITLE_PRODUCT_READY" },
    });
    assert.equal(deskNotifs.length, 1);

    const marker = await prisma.auditLog.findFirst({
      where: { entity: `SavedListItem:${item.id}`, action: "placement-ready.notified" },
    });
    assert.ok(marker, "audit marker recorded");

    const second = await runPlacementReadySweep();
    assert.equal(second.notified, 0, "already-notified item is skipped on rerun");
    assert.equal(
      await prisma.notification.count({ where: { userId: buyerUserId, kind: "TITLE_PRODUCT_READY" } }),
      1,
      "no duplicate notification",
    );
  });

  test("stays quiet when no qualifying product exists (missing / inactive / not bookable / unconfirmed)", async () => {
    const titleNone = await freshTitleWithProduct(null);
    const titleInactive = await freshTitleWithProduct({ active: false });
    const titleNotBookable = await freshTitleWithProduct({ bookable: false });
    const titleUnconfirmed = await freshTitleWithProduct({ confirmed: false });
    const listId = await freshList();
    await prisma.savedListItem.create({ data: { listId, titleId: titleNone } });
    await prisma.savedListItem.create({ data: { listId, titleId: titleInactive } });
    await prisma.savedListItem.create({ data: { listId, titleId: titleNotBookable } });
    await prisma.savedListItem.create({ data: { listId, titleId: titleUnconfirmed } });

    const res = await runPlacementReadySweep();
    assert.equal(res.notified, 0);
  });
}
