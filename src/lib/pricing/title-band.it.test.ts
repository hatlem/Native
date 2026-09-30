import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../prisma";
import { loadPricingDefaults } from "../content-fee";
import { priceBandWhere, refreshStaleTitlePriceBands, titlePriceBandTier } from "./title-band";

// The stored catalog band (Title.priceBandTier): DB triggers invalidate it on
// every write that can move a band, refreshStaleTitlePriceBands recomputes it
// with the catalog's own titleBand(), and the catalog filters on it.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

let marketId = "";
let marketCode = "NO";
let publisherId = "";
let cheapTitleId = "";
let dearTitleId = "";
let cheapProductId = "";

async function bandState(titleId: string) {
  const [row] = await prisma.$queryRaw<
    { tier: number | null; rev: number; computed: number; updatedAt: Date }[]
  >`SELECT "priceBandTier" AS tier, "priceBandRev" AS rev, "priceBandComputedRev" AS computed, "updatedAt"
    FROM "Title" WHERE id = ${titleId}`;
  return { ...row, stale: row.rev !== row.computed };
}

// What the catalog card would show for this title right now.
async function catalogTier(titleId: string): Promise<number | null> {
  const t = await prisma.title.findUniqueOrThrow({
    where: { id: titleId },
    include: { publisher: true, market: true, products: { where: { active: true }, include: { priceRules: true } } },
  });
  return titlePriceBandTier(t.products, t, await loadPricingDefaults());
}

async function makeTitle(name: string, basePrice: number) {
  const title = await prisma.title.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}`,
      publisherId,
      countryCode: marketCode,
      marketId,
      category: "business",
    },
  });
  const product = await prisma.product.create({
    data: {
      titleId: title.id,
      type: "NATIVE_ARTICLE",
      name: `${name} article`,
      basePrice,
      currency: "NOK",
      active: true,
      bookable: true,
      confirmedAt: new Date(),
    },
  });
  return { titleId: title.id, productId: product.id };
}

before(async () => {
  if (!RUN_DB_IT) return;
  const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
  marketId = market.id;
  marketCode = market.code;
  const pub = await prisma.publisher.create({
    data: { name: "Band IT Publisher", countryCode: marketCode, marketId },
  });
  publisherId = pub.id;
  const cheap = await makeTitle("Band IT Cheap", 2_000);
  cheapTitleId = cheap.titleId;
  cheapProductId = cheap.productId;
  dearTitleId = (await makeTitle("Band IT Dear", 200_000)).titleId;
});

after(async () => {
  if (!RUN_DB_IT) return;
  await prisma.priceRule.deleteMany({ where: { product: { title: { publisherId } } } });
  await prisma.product.deleteMany({ where: { title: { publisherId } } });
  await prisma.title.deleteMany({ where: { publisherId } });
  await prisma.publisher.deleteMany({ where: { id: publisherId } });
});

if (!RUN_DB_IT) {
  test("title price band integration (skipped — set RUN_DB_IT=1)", { skip: true }, () => {});
} else {
  test("a new title is stale until recomputed, then stores the catalog card's band", async () => {
    assert.equal((await bandState(cheapTitleId)).stale, true);
    await refreshStaleTitlePriceBands();
    const cheap = await bandState(cheapTitleId);
    const dear = await bandState(dearTitleId);
    assert.equal(cheap.stale, false);
    assert.equal(cheap.tier, await catalogTier(cheapTitleId));
    assert.equal(dear.tier, 5); // 200 000 NOK → the open "90k+" band
    assert.ok(cheap.tier !== null && cheap.tier < 5);
  });

  test("a price change invalidates the band and the recompute moves it", async () => {
    const before = await bandState(cheapTitleId);
    await prisma.product.update({ where: { id: cheapProductId }, data: { basePrice: 150_000 } });
    assert.equal((await bandState(cheapTitleId)).stale, true);
    await refreshStaleTitlePriceBands();
    const after = await bandState(cheapTitleId);
    assert.equal(after.tier, 5);
    assert.equal(after.tier, await catalogTier(cheapTitleId));
    // A recompute is not an edit: the catalog's "newest" sort reads updatedAt.
    assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
  });

  test("visibility, activeness and rate-card writes all invalidate", async () => {
    await refreshStaleTitlePriceBands();

    await prisma.title.update({ where: { id: cheapTitleId }, data: { pricesPublic: false } });
    assert.equal((await bandState(cheapTitleId)).stale, true);
    await refreshStaleTitlePriceBands();
    assert.equal((await bandState(cheapTitleId)).tier, null); // hidden price → no band
    await prisma.title.update({ where: { id: cheapTitleId }, data: { pricesPublic: true } });

    await prisma.publisher.update({ where: { id: publisherId }, data: { pricesPublic: false } });
    assert.equal((await bandState(dearTitleId)).stale, true);
    await prisma.publisher.update({ where: { id: publisherId }, data: { pricesPublic: true } });

    await refreshStaleTitlePriceBands();
    await prisma.priceRule.create({ data: { productId: cheapProductId, marginPct: 40 } });
    assert.equal((await bandState(cheapTitleId)).stale, true);

    await refreshStaleTitlePriceBands();
    await prisma.product.update({ where: { id: cheapProductId }, data: { active: false } });
    await refreshStaleTitlePriceBands();
    assert.equal((await bandState(cheapTitleId)).tier, null);
    await prisma.product.update({ where: { id: cheapProductId }, data: { active: true } });
    await refreshStaleTitlePriceBands();
    assert.equal((await bandState(cheapTitleId)).tier, await catalogTier(cheapTitleId));
  });

  test("a desk margin-rule change invalidates every band", async () => {
    await refreshStaleTitlePriceBands();
    const rule = await prisma.marginRule.create({ data: { marketCode: null, marginPct: 15, active: false } });
    assert.equal((await bandState(dearTitleId)).stale, true);
    await prisma.marginRule.delete({ where: { id: rule.id } });
    await refreshStaleTitlePriceBands();
    assert.equal((await bandState(dearTitleId)).stale, false);
  });

  test("the catalog filter returns exactly the titles in the chosen bands", async () => {
    await prisma.product.update({ where: { id: cheapProductId }, data: { basePrice: 2_000 } });
    await prisma.priceRule.deleteMany({ where: { productId: cheapProductId } });
    await refreshStaleTitlePriceBands();
    const cheapTier = (await bandState(cheapTitleId)).tier!;
    const ids = async (tiers: number[]) =>
      (
        await prisma.title.findMany({
          where: { publisherId, ...priceBandWhere(tiers) },
          select: { id: true },
          orderBy: { id: "asc" },
        })
      ).map((t) => t.id);
    assert.deepEqual(await ids([5]), [dearTitleId]);
    assert.deepEqual(await ids([cheapTier]), [cheapTitleId]);
    assert.deepEqual(await ids([cheapTier, 5]), [cheapTitleId, dearTitleId].sort());
    // No tier chosen = no filter.
    assert.equal((await ids([])).length, 2);
  });
}
