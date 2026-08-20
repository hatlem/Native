import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import {
  resolveEffectiveAsset,
  ensurePlacementForLine,
  lockPlacementsOnFinal,
  articleTitleForLine,
} from "./placement";

// DB-backed integration tests for the ArticlePlacement helper module.
// Named *.it.test.ts (not *.test.ts) per repo convention — see
// src/lib/outreach/campaign.test.ts and package.json's "test" script,
// which greps out `*.it.test.ts` so the default `pnpm test` (unit-only,
// no DB) doesn't try to hit a database. Run this file directly with
// `ALLOW_LOCAL_DB=1 pnpm exec tsx --test src/lib/writers/placement.it.test.ts`
// against a disposable scratch database.
//
// NOTE on the Quote/Request/Plan/Order setup below: the brief's draft test
// used a bare `prisma.quote.create({ data: { organizationId, ... } })`,
// flagged in its own comment as unverified. The real schema (see
// prisma/schema.prisma) has no `organizationId` on Quote at all — Quote
// hangs off Request (requestId, required), Request hangs off Plan
// (planId, required, @unique), and Quote additionally requires
// `subtotal`/`vatPct` (both required Decimal, no default). Order does take
// `organizationId` directly, plus the required `quoteId`. This file builds
// the full Plan → Request → Quote → Order chain instead, matching the
// pattern already used in src/app/article-library.it.test.ts.

// Helper: build a fresh Organization + full commerce chain down to one
// OrderLine, so each test isn't 8 lines of chain-building boilerplate.
async function makeOrderLine(orgId: string, opts?: { authorshipMode?: "BUYER_SUPPLIED" | "NATIVESPIN_PRODUCED"; productId?: string }) {
  const plan = await prisma.plan.create({ data: { organizationId: orgId } });
  const request = await prisma.request.create({ data: { organizationId: orgId, planId: plan.id, status: "DRAFT" } });
  const quote = await prisma.quote.create({
    data: { requestId: request.id, status: "ACCEPTED", currency: "EUR", subtotal: 0, vatPct: 0, total: 0 },
  });
  const order = await prisma.order.create({ data: { organizationId: orgId, quoteId: quote.id, status: "CONFIRMED" } });
  const line = await prisma.orderLine.create({
    data: {
      orderId: order.id,
      kind: "INVENTORY",
      authorshipMode: opts?.authorshipMode ?? "BUYER_SUPPLIED",
      quantity: 1,
      lineTotal: 0,
      productId: opts?.productId,
    },
  });
  return {
    line,
    async cleanup() {
      await prisma.orderLine.delete({ where: { id: line.id } });
      await prisma.order.delete({ where: { id: order.id } });
      await prisma.quote.delete({ where: { id: quote.id } });
      await prisma.request.delete({ where: { id: request.id } });
      await prisma.plan.delete({ where: { id: plan.id } });
    },
  };
}

test("resolveEffectiveAsset follows the latest version when unlocked", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Org 1", type: "ADVERTISER" } });
  const user = await prisma.user.create({ data: { email: `it-1-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id } });
  const article = await prisma.article.create({
    data: { organizationId: org.id, title: "T", createdByUserId: user.id, createdByRole: "BUYER" },
  });
  await prisma.contentAsset.create({ data: { articleId: article.id, version: 1, body: "v1" } });
  const v2 = await prisma.contentAsset.create({ data: { articleId: article.id, version: 2, body: "v2" } });

  const effective = await resolveEffectiveAsset({ articleId: article.id, lockedAssetId: null });
  assert.equal(effective?.id, v2.id);

  await prisma.contentAsset.deleteMany({ where: { articleId: article.id } });
  await prisma.article.delete({ where: { id: article.id } });
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("resolveEffectiveAsset returns the locked version even after a newer one exists", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Org 2", type: "ADVERTISER" } });
  const user = await prisma.user.create({ data: { email: `it-2-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id } });
  const article = await prisma.article.create({
    data: { organizationId: org.id, title: "T", createdByUserId: user.id, createdByRole: "BUYER" },
  });
  const v1 = await prisma.contentAsset.create({ data: { articleId: article.id, version: 1, body: "v1", status: "FINAL" } });
  await prisma.contentAsset.create({ data: { articleId: article.id, version: 2, body: "v2" } });

  const effective = await resolveEffectiveAsset({ articleId: article.id, lockedAssetId: v1.id });
  assert.equal(effective?.id, v1.id);
  assert.equal(effective?.body, "v1");

  await prisma.contentAsset.deleteMany({ where: { articleId: article.id } });
  await prisma.article.delete({ where: { id: article.id } });
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("ensurePlacementForLine creates on first call, reuses on second", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Org 3", type: "ADVERTISER" } });
  const user = await prisma.user.create({ data: { email: `it-3-${Date.now()}@example.com`, role: "DESK" } });
  const { line, cleanup } = await makeOrderLine(org.id);

  const first = await ensurePlacementForLine({
    orderLineId: line.id,
    organizationId: org.id,
    title: "Untitled article",
    createdByUserId: user.id,
    createdByRole: "DESK",
  });
  const second = await ensurePlacementForLine({
    orderLineId: line.id,
    organizationId: org.id,
    title: "Untitled article",
    createdByUserId: user.id,
    createdByRole: "DESK",
  });
  assert.equal(first.id, second.id);
  assert.equal(first.articleId, second.articleId);
  assert.equal(await prisma.articlePlacement.count({ where: { orderLineId: line.id } }), 1);

  await prisma.articlePlacement.delete({ where: { id: first.id } });
  await prisma.article.delete({ where: { id: first.articleId } });
  await cleanup();
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("ensurePlacementForLine applies assignedWriterId to the Article (not the placement) on create, reuse, clear, and leaves it untouched when the argument is omitted", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Org 3b", type: "ADVERTISER" } });
  const deskUser = await prisma.user.create({ data: { email: `it-3b-desk-${Date.now()}@example.com`, role: "DESK" } });
  const writerUser = await prisma.user.create({ data: { email: `it-3b-writer-${Date.now()}@example.com`, role: "CONTENT" } });
  const writerProfile = await prisma.writerProfile.create({ data: { userId: writerUser.id } });
  const { line, cleanup } = await makeOrderLine(org.id, { authorshipMode: "NATIVESPIN_PRODUCED" });

  const baseArgs = {
    orderLineId: line.id,
    organizationId: org.id,
    title: "Untitled article",
    createdByUserId: deskUser.id,
    createdByRole: "DESK" as const,
  };

  // Created WITH a writer: the writer lands on the ARTICLE.
  const created = await ensurePlacementForLine({ ...baseArgs, assignedWriterId: writerProfile.id });
  let article = await prisma.article.findUniqueOrThrow({ where: { id: created.articleId } });
  assert.equal(article.assignedWriterId, writerProfile.id);

  // Reusing the existing placement WITHOUT assignedWriterId (i.e. the key is
  // simply absent, `undefined`) must leave the writer untouched — this is
  // the `!== undefined` check, not a falsy check.
  const reused = await ensurePlacementForLine(baseArgs);
  assert.equal(reused.id, created.id);
  article = await prisma.article.findUniqueOrThrow({ where: { id: created.articleId } });
  assert.equal(article.assignedWriterId, writerProfile.id);

  // Reusing WITH assignedWriterId: null explicitly clears it on the
  // found-existing path.
  const cleared = await ensurePlacementForLine({ ...baseArgs, assignedWriterId: null });
  assert.equal(cleared.id, created.id);
  article = await prisma.article.findUniqueOrThrow({ where: { id: created.articleId } });
  assert.equal(article.assignedWriterId, null);

  await prisma.articlePlacement.delete({ where: { id: created.id } });
  await prisma.article.delete({ where: { id: created.articleId } });
  await cleanup();
  await prisma.writerProfile.delete({ where: { id: writerProfile.id } });
  await prisma.notification.deleteMany({ where: { userId: { in: [writerUser.id, deskUser.id] } } });
  await prisma.user.delete({ where: { id: writerUser.id } });
  await prisma.user.delete({ where: { id: deskUser.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("ensurePlacementForLine resolves a genuine concurrent race for the same line onto one placement (P2002 path)", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Org 3c", type: "ADVERTISER" } });
  const user = await prisma.user.create({ data: { email: `it-3c-${Date.now()}@example.com`, role: "DESK" } });
  const { line, cleanup } = await makeOrderLine(org.id);

  const args = {
    orderLineId: line.id,
    organizationId: org.id,
    title: "Untitled article",
    createdByUserId: user.id,
    createdByRole: "DESK" as const,
  };
  // Two genuinely concurrent first-writes for the same line (desk staffing
  // a writer racing desk/writer composing the first draft) — launched via
  // Promise.all so both `findUnique`-miss before either creates anything,
  // guaranteeing both reach `articlePlacement.create` and collide on the
  // unique orderLineId. This is what actually exercises the P2002 catch
  // branch in placement.ts, unlike two sequential calls (which would never
  // race — the second call's findUnique would just see the first's row).
  const [a, b] = await Promise.all([ensurePlacementForLine(args), ensurePlacementForLine(args)]);
  assert.equal(a.id, b.id);
  assert.equal(a.articleId, b.articleId);
  assert.equal(await prisma.articlePlacement.count({ where: { orderLineId: line.id } }), 1);

  // The race's loser leaves an orphaned Article behind by design (see the
  // comment in placement.ts) — sweep every Article under this org, not
  // just the surviving one, so the org can be deleted.
  await prisma.articlePlacement.deleteMany({ where: { orderLineId: line.id } });
  await prisma.article.deleteMany({ where: { organizationId: org.id } });
  await cleanup();
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("lockPlacementsOnFinal locks every unlocked placement of the article, leaves already-locked ones alone", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Org 4", type: "ADVERTISER" } });
  const user = await prisma.user.create({ data: { email: `it-4-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id } });
  const article = await prisma.article.create({
    data: { organizationId: org.id, title: "T", createdByUserId: user.id, createdByRole: "BUYER" },
  });
  const { line: line1, cleanup: cleanup1 } = await makeOrderLine(org.id);
  const { line: line2, cleanup: cleanup2 } = await makeOrderLine(org.id);

  const placement1 = await prisma.articlePlacement.create({ data: { orderLineId: line1.id, articleId: article.id } });
  const priorFinal = await prisma.contentAsset.create({ data: { articleId: article.id, version: 1, body: "old", status: "FINAL" } });
  const placement2 = await prisma.articlePlacement.create({
    data: { orderLineId: line2.id, articleId: article.id, lockedAssetId: priorFinal.id },
  });

  const v2 = await prisma.contentAsset.create({ data: { articleId: article.id, version: 2, body: "new", status: "FINAL" } });
  await lockPlacementsOnFinal(article.id, v2.id);

  const reloaded1 = await prisma.articlePlacement.findUniqueOrThrow({ where: { id: placement1.id } });
  const reloaded2 = await prisma.articlePlacement.findUniqueOrThrow({ where: { id: placement2.id } });
  assert.equal(reloaded1.lockedAssetId, v2.id);
  assert.notEqual(reloaded2.lockedAssetId, v2.id);
  assert.equal(reloaded2.lockedAssetId, priorFinal.id);

  await prisma.articlePlacement.deleteMany({ where: { articleId: article.id } });
  await prisma.contentAsset.deleteMany({ where: { articleId: article.id } });
  await prisma.article.delete({ where: { id: article.id } });
  await cleanup1();
  await cleanup2();
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("articleTitleForLine resolves the line's product/title name, falling back to a generic label when there's no product or the product is unresolvable", async () => {
  // Market "NO" is seeded (pnpm db:seed runs before pnpm test:it in CI, and
  // dev DBs are seeded too), and Market.code is @unique — so this must reuse
  // the seeded row rather than unconditionally `create`, matching the
  // findFirstOrThrow({ where: { code: "NO" } }) pattern used throughout the
  // other *.it.test.ts files (see content-fee.it.test.ts, checkout.it.test.ts,
  // campaign.it.test.ts, api/contract.it.test.ts, ratecard/store.it.test.ts,
  // pricing/contact-log.it.test.ts). Not owned by this test, so it's never
  // deleted in teardown either.
  const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
  const publisher = await prisma.publisher.create({
    data: { name: `IT Publisher ${Date.now()}`, countryCode: market.code, marketId: market.id },
  });
  const title = await prisma.title.create({
    data: {
      name: "Aftenavisen",
      slug: `it-title-${Date.now()}`,
      publisherId: publisher.id,
      countryCode: market.code,
      marketId: market.id,
      category: "business",
    },
  });
  const product = await prisma.product.create({
    data: { titleId: title.id, type: "NATIVE_ARTICLE", name: "Native piece", basePrice: 5000, currency: market.currency },
  });

  const org = await prisma.organization.create({ data: { name: "IT Org 5", type: "ADVERTISER" } });
  const { line: lineNoProduct, cleanup: cleanupNoProduct } = await makeOrderLine(org.id);
  const { line: lineDanglingProduct, cleanup: cleanupDangling } = await makeOrderLine(org.id, {
    productId: "nonexistent-product-id",
  });
  const { line: lineWithProduct, cleanup: cleanupWithProduct } = await makeOrderLine(org.id, { productId: product.id });

  assert.equal(await articleTitleForLine(lineNoProduct.id), "Untitled article");
  assert.equal(await articleTitleForLine(lineDanglingProduct.id), "Untitled article");
  assert.equal(await articleTitleForLine(lineWithProduct.id), "Aftenavisen");
  // Nonexistent line id: line lookup returns null too.
  assert.equal(await articleTitleForLine("nonexistent-line-id"), "Untitled article");

  await cleanupNoProduct();
  await cleanupDangling();
  await cleanupWithProduct();
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.product.delete({ where: { id: product.id } });
  await prisma.title.delete({ where: { id: title.id } });
  await prisma.publisher.delete({ where: { id: publisher.id } });
  // market is the seeded shared row (found via findFirstOrThrow above, never
  // created here) — do not delete it.
});
