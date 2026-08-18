import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureActiveList, addProductItem } from "./lists";
import { createProgramme, loadProgrammeForList, findDueWaves, ProgrammeError } from "./programme";

// Programme domain logic at the lib layer (server actions need a session and
// throw NEXT_REDIRECT — same convention as lists.flow.it.test.ts). Covers the
// invariants the feature depends on: a wave copy carries EVERYTHING the buyer
// set (the old duplicatePlan stub dropped budget/targeting/content mode), wave
// numbers are dense and unique, a list can't be enrolled twice, and the
// due-wave scan fires only for the wave right after a live/finished one.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

let orgId = "";
let productId = "";

before(async () => {
  if (!RUN_DB_IT) return;
  const market = await prisma.market.findFirst();
  const org = await prisma.organization.create({
    data: { name: "Programme IT Org", type: "ADVERTISER", marketCode: market?.code ?? "NO" },
  });
  orgId = org.id;
  const product = await prisma.product.findFirst({ where: { active: true, bookable: true }, select: { id: true } });
  productId = product!.id;
});

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.order.deleteMany({ where: { organizationId: orgId } });
  await prisma.quote.deleteMany({ where: { request: { organizationId: orgId } } });
  await prisma.request.deleteMany({ where: { organizationId: orgId } });
  await prisma.planItem.deleteMany({ where: { plan: { organizationId: orgId } } });
  await prisma.plan.deleteMany({ where: { organizationId: orgId } });
  await prisma.savedListItem.deleteMany({ where: { list: { organizationId: orgId } } });
  await prisma.savedList.deleteMany({ where: { organizationId: orgId } });
  await prisma.campaignProgramme.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
});

if (!RUN_DB_IT) {
  test("programme integration (skipped — set RUN_DB_IT=1)", { skip: true }, () => {});
} else {
  test("createProgramme: wave copies carry every list + item field, schedule shifted", async () => {
    const list = await ensureActiveList(orgId, null);
    await prisma.savedList.update({
      where: { id: list.id },
      data: {
        name: "ABAX trade press",
        budget: 120000,
        currency: "NOK",
        goal: "Kjennskap i transportbransjen",
        targetGeo: "NO",
        targetAudience: "fleet-managers",
        targetContext: "transport",
        targetVerticals: "transport,anlegg",
        note: "internal note",
      },
    });
    await addProductItem(list.id, productId, true);
    await prisma.savedListItem.updateMany({
      where: { listId: list.id },
      data: { scheduleStart: new Date("2026-09-01T00:00:00Z"), scheduleUnits: 1, notes: "line note" },
    });

    const { programmeId, waveListIds } = await createProgramme({
      sourceListId: list.id,
      organizationId: orgId,
      userId: null,
      waves: 3,
      spacingWeeks: 8,
      angles: ["Problem", "Proof", "How-to"],
      rationaleKey: "monthlyCycle",
    });
    assert.equal(waveListIds.length, 3);
    assert.equal(waveListIds[0], list.id, "the source list becomes wave 1");

    const waves = await prisma.savedList.findMany({
      where: { programmeId },
      orderBy: { waveNumber: "asc" },
      include: { items: true },
    });
    assert.deepEqual(waves.map((w) => w.waveNumber), [1, 2, 3]);
    assert.deepEqual(waves.map((w) => w.articleAngle), ["Problem", "Proof", "How-to"]);
    const w2 = waves[1];
    assert.equal(w2.name, "ABAX trade press · Wave 2");
    assert.equal(Number(w2.budget), 120000);
    assert.equal(w2.currency, "NOK");
    assert.equal(w2.goal, "Kjennskap i transportbransjen");
    assert.equal(w2.targetVerticals, "transport,anlegg");
    assert.equal(w2.targetAudience, "fleet-managers");
    assert.equal(w2.note, "internal note");
    assert.equal(w2.items.length, 1);
    assert.equal(w2.items[0].productId, productId);
    assert.equal(w2.items[0].withContent, true);
    assert.equal(w2.items[0].notes, "line note");
    // 8 weeks ≈ 2 months on a MONTH grid, 8 weeks exactly on a WEEK grid — either way strictly later.
    assert.ok(w2.items[0].scheduleStart! > new Date("2026-09-01T00:00:00Z"));
    assert.ok(waves[2].items[0].scheduleStart! > w2.items[0].scheduleStart!);

    await assert.rejects(
      createProgramme({
        sourceListId: list.id,
        organizationId: orgId,
        userId: null,
        waves: 2,
        spacingWeeks: 4,
        angles: [],
        rationaleKey: null,
      }),
      (e: unknown) => e instanceof ProgrammeError && e.code === "already-in-programme",
    );

    const view = await loadProgrammeForList(w2.id);
    assert.equal(view?.plannedWaves, 3);
    assert.deepEqual(view?.waves.map((w) => w.state), ["draft", "draft", "draft"]);
  });

  test("findDueWaves: wave 2 becomes due once wave 1 has a LIVE order", async () => {
    const list = await ensureActiveList(orgId, null);
    // A fresh list for this test (the previous one is already a wave).
    const fresh = await prisma.savedList.create({ data: { organizationId: orgId, name: "Due test" } });
    void list;
    await addProductItem(fresh.id, productId);
    const { waveListIds } = await createProgramme({
      sourceListId: fresh.id,
      organizationId: orgId,
      userId: null,
      waves: 2,
      spacingWeeks: 6,
      angles: [null, null],
      rationaleKey: "default",
    });

    const now = new Date("2026-08-18T00:00:00Z");
    assert.equal((await findDueWaves([orgId], now)).filter((d) => d.listId === waveListIds[1]).length, 0);

    // Wave 1 → submitted → quoted → LIVE order.
    const plan = await prisma.plan.create({ data: { organizationId: orgId, name: "wave1" } });
    const request = await prisma.request.create({
      data: { organizationId: orgId, planId: plan.id, status: "CLOSED", sourceListId: waveListIds[0] },
    });
    const quote = await prisma.quote.create({
      data: { requestId: request.id, status: "ACCEPTED", currency: "NOK", subtotal: 0, vatPct: 25, total: 0 },
    });
    await prisma.order.create({ data: { organizationId: orgId, quoteId: quote.id, status: "LIVE" } });

    const due = (await findDueWaves([orgId], now)).filter((d) => d.listId === waveListIds[1]);
    assert.equal(due.length, 1);
    assert.equal(due[0].reason, "previous-live");
    assert.equal(due[0].waveNumber, 2);
    assert.equal(due[0].plannedWaves, 2);
  });
}
