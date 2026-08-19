import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import {
  loadPublisherRateCard,
  confirmProductPrice,
  updateProductPrice,
  PublisherRatesError,
} from "./publisher-rates";

// Publisher self-serve rate confirmation at the lib layer (server actions
// need a session and throw NEXT_REDIRECT — same convention as
// programme.it.test.ts). Covers the invariants the feature depends on:
// the ownership guard never lets one publisher touch another's product,
// an update changes ONLY the price plus provenance (never the desk-owned
// curation flags), and a confirm stamps provenance without moving the
// price.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

const ACTOR = "it-publisher-rates-actor";

let publisherAId = "";
let publisherBId = "";
let titleAId = "";
let productAId = "";

before(async () => {
  if (!RUN_DB_IT) return;
  const market = await prisma.market.findFirst();
  const code = market?.code ?? "NO";
  const marketId = market!.id;

  const pubA = await prisma.publisher.create({
    data: { name: "Rates IT Publisher A", countryCode: code, marketId },
  });
  publisherAId = pubA.id;
  const pubB = await prisma.publisher.create({
    data: { name: "Rates IT Publisher B", countryCode: code, marketId },
  });
  publisherBId = pubB.id;

  const titleA = await prisma.title.create({
    data: {
      name: "Rates IT Title A",
      slug: `rates-it-title-a-${Date.now()}`,
      publisherId: publisherAId,
      countryCode: code,
      marketId,
      category: "business",
    },
  });
  titleAId = titleA.id;

  const productA = await prisma.product.create({
    data: {
      titleId: titleAId,
      type: "ADVERTORIAL",
      name: "Rates IT Advertorial",
      basePrice: 40000,
      currency: "NOK",
      active: false,
      bookable: false,
    },
  });
  productAId = productA.id;
});

after(async () => {
  if (!RUN_DB_IT) return;
  // updateProductPrice notifies the desk with a link to the test title —
  // remove those rows so repeated runs don't pile up inbox noise.
  await prisma.notification.deleteMany({
    where: { link: { contains: `/desk/titles/${titleAId}` } },
  });
  await prisma.auditLog.deleteMany({ where: { actor: ACTOR } });
  await prisma.product.deleteMany({ where: { titleId: titleAId } });
  await prisma.title.deleteMany({
    where: { publisherId: { in: [publisherAId, publisherBId] } },
  });
  await prisma.publisher.deleteMany({
    where: { id: { in: [publisherAId, publisherBId] } },
  });
});

if (!RUN_DB_IT) {
  test(
    "publisher-rates integration (skipped — set RUN_DB_IT=1)",
    { skip: true },
    () => {},
  );
} else {
  test("ownership guard: another publisher's product is invisible to both mutations", async () => {
    await assert.rejects(
      confirmProductPrice({
        publisherId: publisherBId,
        productId: productAId,
        actorUserId: ACTOR,
      }),
      (err: unknown) =>
        err instanceof PublisherRatesError && err.code === "not-found",
    );
    await assert.rejects(
      updateProductPrice({
        publisherId: publisherBId,
        productId: productAId,
        basePrice: 1,
        actorUserId: ACTOR,
      }),
      (err: unknown) =>
        err instanceof PublisherRatesError && err.code === "not-found",
    );
    // Nothing moved, nothing stamped.
    const p = await prisma.product.findUniqueOrThrow({
      where: { id: productAId },
    });
    assert.equal(Number(p.basePrice), 40000);
    assert.equal(p.confirmedAt, null);
  });

  test("updateProductPrice: changes price, stamps provenance, audits from/to — curation flags untouched", async () => {
    await updateProductPrice({
      publisherId: publisherAId,
      productId: productAId,
      basePrice: 52000,
      actorUserId: ACTOR,
    });

    const p = await prisma.product.findUniqueOrThrow({
      where: { id: productAId },
    });
    assert.equal(Number(p.basePrice), 52000);
    assert.ok(p.confirmedAt, "confirmedAt stamped");
    assert.equal(p.confirmedSource, `publisher-portal:User:${ACTOR}`);
    // Price-only by design — the desk keeps the curation gate.
    assert.equal(p.active, false);
    assert.equal(p.bookable, false);
    assert.equal(p.visibility, "INDICATIVE");

    const audit = await prisma.auditLog.findFirst({
      where: {
        actor: ACTOR,
        action: "product.price_update",
        entity: `Product:${productAId}`,
      },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit, "audit row written");
    const detail = JSON.parse(audit!.detail ?? "{}");
    assert.equal(detail.from, 40000);
    assert.equal(detail.to, 52000);
  });

  test("updateProductPrice: rejects an invalid price before touching the row", async () => {
    await assert.rejects(
      updateProductPrice({
        publisherId: publisherAId,
        productId: productAId,
        basePrice: 0,
        actorUserId: ACTOR,
      }),
      (err: unknown) =>
        err instanceof PublisherRatesError && err.code === "invalid-price",
    );
    const p = await prisma.product.findUniqueOrThrow({
      where: { id: productAId },
    });
    assert.equal(Number(p.basePrice), 52000);
  });

  test("confirmProductPrice: stamps provenance without changing the price", async () => {
    const beforeStamp = await prisma.product.findUniqueOrThrow({
      where: { id: productAId },
    });
    await new Promise((r) => setTimeout(r, 5));

    await confirmProductPrice({
      publisherId: publisherAId,
      productId: productAId,
      actorUserId: ACTOR,
    });

    const p = await prisma.product.findUniqueOrThrow({
      where: { id: productAId },
    });
    assert.equal(Number(p.basePrice), 52000);
    assert.ok(p.confirmedAt!.getTime() > beforeStamp.confirmedAt!.getTime());
    assert.equal(p.confirmedSource, `publisher-portal:User:${ACTOR}`);

    const audit = await prisma.auditLog.findFirst({
      where: {
        actor: ACTOR,
        action: "product.price_confirm",
        entity: `Product:${productAId}`,
      },
    });
    assert.ok(audit, "confirm audit row written");
  });

  test("loadPublisherRateCard: returns own titles/products with provenance, never a foreign one", async () => {
    const cardA = await loadPublisherRateCard(publisherAId);
    const title = cardA.find((t) => t.id === titleAId);
    assert.ok(title, "own title present");
    const product = title!.products.find((p) => p.id === productAId);
    assert.ok(product, "own product present");
    assert.equal(product!.basePrice, 52000);
    assert.ok(product!.confirmedAt);

    const cardB = await loadPublisherRateCard(publisherBId);
    assert.equal(cardB.some((t) => t.id === titleAId), false);
  });
}
