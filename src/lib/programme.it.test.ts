import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { ensureActiveList, addProductItem } from "./lists";
import {
  createProgramme,
  loadProgrammeForList,
  findDueWaves,
  copyListForNewWave,
  sourceListForOrder,
  planWaveDates,
  ProgrammeError,
} from "./programme";
import { runAutoSendSweep } from "./programme-autosend";

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
      now: new Date("2026-08-18T00:00:00Z"),
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

  test("createProgramme: unscheduled source lines get the previewed wave anchors", async () => {
    const now = new Date("2026-08-18T00:00:00Z");
    const fresh = await prisma.savedList.create({ data: { organizationId: orgId, name: "Unscheduled" } });
    await addProductItem(fresh.id, productId); // deliberately NO scheduleStart
    const { programmeId } = await createProgramme({
      sourceListId: fresh.id,
      organizationId: orgId,
      userId: null,
      waves: 3,
      spacingWeeks: 6,
      angles: [null, null, null],
      rationaleKey: "default",
      now,
    });

    const waves = await prisma.savedList.findMany({
      where: { programmeId },
      orderBy: { waveNumber: "asc" },
      include: { items: true },
    });
    // Wave 1 IS the source list — untouched, still unscheduled.
    assert.equal(waves[0].items[0].scheduleStart, null);
    // Waves 2..N land on exactly the dates the /plan form previewed
    // (planWaveDates with no first start → current period + k·spacing).
    const unit = (await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { bookingUnit: true },
    })).bookingUnit;
    const previewed = planWaveDates(null, 3, 6, unit, now);
    assert.equal(waves[1].items[0].scheduleStart!.toISOString(), previewed[1]!.toISOString());
    assert.equal(waves[2].items[0].scheduleStart!.toISOString(), previewed[2]!.toISOString());
    // Length stays open — the publisher's minimum run applies downstream.
    assert.equal(waves[1].items[0].scheduleUnits, null);
    assert.equal(waves[2].items[0].scheduleUnits, null);
  });

  test("sourceListForOrder + copyListForNewWave(resetSchedule): full copy, schedule dropped", async () => {
    // The lib path behind duplicatePlan ("Plan next wave" from a past order):
    // order → sourceListForOrder → copyListForNewWave({resetSchedule:true}).
    const src = await prisma.savedList.create({
      data: {
        organizationId: orgId,
        name: "Dup source",
        note: "keep me",
        budget: 45000,
        currency: "NOK",
        goal: "Awareness in trade press",
        audienceNote: "fleet operators",
        targetGeo: "NO",
        targetAudience: "fleet-managers",
        targetContext: "transport",
        targetVerticals: "transport,anlegg",
      },
    });
    await addProductItem(src.id, productId, true);
    await prisma.savedListItem.updateMany({
      where: { listId: src.id },
      data: {
        quantity: 3,
        authorshipMode: "NATIVESPIN_PRODUCED",
        scheduleStart: new Date("2026-10-01T00:00:00Z"),
        scheduleUnits: 2,
        notes: "dup line note",
      },
    });
    // Minimal submitted → quoted → ordered chain (same as the due-wave test).
    const plan = await prisma.plan.create({ data: { organizationId: orgId, name: "dup" } });
    const request = await prisma.request.create({
      data: { organizationId: orgId, planId: plan.id, status: "CLOSED", sourceListId: src.id },
    });
    const quote = await prisma.quote.create({
      data: { requestId: request.id, status: "ACCEPTED", currency: "NOK", subtotal: 0, vatPct: 25, total: 0 },
    });
    const order = await prisma.order.create({
      data: { organizationId: orgId, quoteId: quote.id, status: "COMPLETED" },
    });

    const source = await sourceListForOrder(order.id);
    assert.ok(source, "the order traces back to its source list");
    assert.equal(source!.id, src.id);

    const copyId = await prisma.$transaction((tx) =>
      copyListForNewWave(
        source!,
        { name: "Dup source · next wave", shiftWeeks: 0, resetSchedule: true, createdById: null },
        tx,
      ),
    );
    const copy = await prisma.savedList.findUniqueOrThrow({
      where: { id: copyId },
      include: { items: true },
    });
    // Every list field the buyer set survives the copy…
    assert.equal(copy.name, "Dup source · next wave");
    assert.equal(copy.note, "keep me");
    assert.equal(Number(copy.budget), 45000);
    assert.equal(copy.currency, "NOK");
    assert.equal(copy.goal, "Awareness in trade press");
    assert.equal(copy.audienceNote, "fleet operators");
    assert.equal(copy.targetGeo, "NO");
    assert.equal(copy.targetAudience, "fleet-managers");
    assert.equal(copy.targetContext, "transport");
    assert.equal(copy.targetVerticals, "transport,anlegg");
    // …but the copy is NOT enrolled in any programme.
    assert.equal(copy.programmeId, null);
    assert.equal(copy.waveNumber, null);
    // Every item field too, with the schedule reset (dates were in the past).
    assert.equal(copy.items.length, 1);
    const item = copy.items[0];
    assert.equal(item.productId, productId);
    assert.equal(item.titleId, null);
    assert.equal(item.quantity, 3);
    assert.equal(item.withContent, true);
    assert.equal(item.authorshipMode, "NATIVESPIN_PRODUCED");
    assert.equal(item.notes, "dup line note");
    assert.equal(item.sortOrder, 0);
    assert.equal(item.scheduleStart, null);
    assert.equal(item.scheduleUnits, null);
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
      now: new Date("2026-08-18T00:00:00Z"),
    });

    // Wave 2 now carries an anchor date (≥ 2026-09-01 on either booking
    // unit), so scan from a "now" whose 21-day horizon can't reach it —
    // this test is about the previous-live trigger, not date-near.
    const now = new Date("2026-08-01T00:00:00Z");
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

  test("runAutoSendSweep: sends a due opted-in wave exactly once, never touches non-opted programmes", async () => {
    const now = new Date("2026-08-18T00:00:00Z");

    // Two identical 2-wave programmes; only the first opts in to auto-send.
    const makeProgramme = async (name: string, autoSend: boolean) => {
      const src = await prisma.savedList.create({
        data: { organizationId: orgId, name, goal: "Awareness", budget: 10000, currency: "NOK" },
      });
      await addProductItem(src.id, productId);
      const { waveListIds } = await createProgramme({
        sourceListId: src.id,
        organizationId: orgId,
        userId: null,
        waves: 2,
        spacingWeeks: 6,
        angles: ["First angle", "Second angle"],
        rationaleKey: "default",
        autoSend,
        now,
      });
      // Wave 1 → submitted → quoted → LIVE order, which makes wave 2 due.
      const plan = await prisma.plan.create({ data: { organizationId: orgId, name: `${name} w1` } });
      const request = await prisma.request.create({
        data: { organizationId: orgId, planId: plan.id, status: "CLOSED", sourceListId: waveListIds[0] },
      });
      const quote = await prisma.quote.create({
        data: { requestId: request.id, status: "ACCEPTED", currency: "NOK", subtotal: 0, vatPct: 25, total: 0 },
      });
      await prisma.order.create({ data: { organizationId: orgId, quoteId: quote.id, status: "LIVE" } });
      return waveListIds;
    };
    const auto = await makeProgramme("Auto prog", true);
    const manual = await makeProgramme("Manual prog", false);

    await runAutoSendSweep(now);

    // The opted-in wave was submitted through the normal RFQ path…
    const sentRequests = await prisma.request.findMany({
      where: { sourceListId: auto[1] },
      select: { status: true, briefSummary: true, plan: { select: { goal: true, budget: true } } },
    });
    assert.equal(sentRequests.length, 1, "exactly one request for the due auto-send wave");
    assert.equal(sentRequests[0].status, "SUBMITTED");
    // …with the wave's angle at the top of the desk brief and the list's
    // stored brief fields on the plan.
    assert.match(sentRequests[0].briefSummary ?? "", /wave 2 of 2.*Second angle/);
    assert.equal(sentRequests[0].plan.goal, "Awareness");
    assert.equal(Number(sentRequests[0].plan.budget), 10000);
    // The non-opted programme's wave 2 stays a draft.
    assert.equal(await prisma.request.count({ where: { sourceListId: manual[1] } }), 0);

    // A second sweep is a no-op: the wave now has a Request, so it is no
    // longer a draft (and therefore never due again).
    await runAutoSendSweep(now);
    assert.equal(await prisma.request.count({ where: { sourceListId: auto[1] } }), 1);
    assert.equal(await prisma.request.count({ where: { sourceListId: manual[1] } }), 0);
  });
}
