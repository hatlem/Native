import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { canWriteArticle } from "@/lib/writers/access";

// This suite exercises the DB-backed paths that access.ts's unit tests
// (Task 2) can't cover: Prisma relations, the unique ArticlePlacement.
// orderLineId constraint, and the writer-assignment auto-creation hook
// (Task 5).

test("buyer can create an unlinked article, upload a file, and see it in their org's overview", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Test Org", type: "ADVERTISER" } });
  const user = await prisma.user.create({
    data: { email: `it-buyer-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id },
  });

  const article = await prisma.article.create({
    data: {
      organizationId: org.id,
      title: "Buyer-supplied piece",
      createdByUserId: user.id,
      createdByRole: "BUYER",
    },
  });

  const version = await prisma.contentAsset.create({
    data: { articleId: article.id, version: 1, status: "DRAFT", bodyUrl: "articles/x/2026-08-19/abc-file.pdf" },
  });
  assert.equal(version.body, null);

  const found = await prisma.article.findMany({ where: { organizationId: org.id } });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, article.id);

  await prisma.contentAsset.delete({ where: { id: version.id } });
  await prisma.article.delete({ where: { id: article.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("an order line can be linked to at most one placement (unique constraint), but one article can have many placements", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Test Org 2", type: "ADVERTISER" } });
  const user = await prisma.user.create({
    data: { email: `it-buyer2-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id },
  });
  const plan = await prisma.plan.create({ data: { organizationId: org.id, name: "IT plan" } });
  const request = await prisma.request.create({ data: { organizationId: org.id, planId: plan.id, status: "DRAFT" } });
  const quote = await prisma.quote.create({ data: { requestId: request.id, status: "ACCEPTED", currency: "EUR", subtotal: 0, vatPct: 0, total: 0 } });
  const order = await prisma.order.create({ data: { organizationId: org.id, quoteId: quote.id, status: "CONFIRMED" } });
  const lineA = await prisma.orderLine.create({ data: { orderId: order.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 } });
  const lineB = await prisma.orderLine.create({ data: { orderId: order.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 } });

  const article = await prisma.article.create({
    data: { organizationId: org.id, title: "Shared piece", createdByUserId: user.id, createdByRole: "BUYER" },
  });
  const placementA = await prisma.articlePlacement.create({ data: { orderLineId: lineA.id, articleId: article.id } });
  // Same article, a DIFFERENT line — must succeed (this is the reuse this
  // whole plan exists to enable).
  const placementB = await prisma.articlePlacement.create({ data: { orderLineId: lineB.id, articleId: article.id } });
  assert.equal(await prisma.articlePlacement.count({ where: { articleId: article.id } }), 2);

  // A SECOND placement on the SAME line must reject.
  const otherArticle = await prisma.article.create({
    data: { organizationId: org.id, title: "Different piece", createdByUserId: user.id, createdByRole: "BUYER" },
  });
  await assert.rejects(() =>
    prisma.articlePlacement.create({ data: { orderLineId: lineA.id, articleId: otherArticle.id } }),
  );

  await prisma.articlePlacement.deleteMany({ where: { id: { in: [placementA.id, placementB.id] } } });
  await prisma.article.deleteMany({ where: { id: { in: [article.id, otherArticle.id] } } });
  await prisma.orderLine.deleteMany({ where: { id: { in: [lineA.id, lineB.id] } } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.quote.delete({ where: { id: quote.id } });
  await prisma.request.delete({ where: { id: request.id } });
  await prisma.plan.delete({ where: { id: plan.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("retracting one placement doesn't affect a sibling placement of the same article; FINAL locks unlocked placements", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Test Org 5", type: "ADVERTISER" } });
  const user = await prisma.user.create({
    data: { email: `it-buyer5-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id },
  });
  const plan = await prisma.plan.create({ data: { organizationId: org.id, name: "IT plan 5" } });
  const request = await prisma.request.create({ data: { organizationId: org.id, planId: plan.id, status: "DRAFT" } });
  const quote = await prisma.quote.create({ data: { requestId: request.id, status: "ACCEPTED", currency: "EUR", subtotal: 0, vatPct: 0, total: 0 } });
  const order = await prisma.order.create({ data: { organizationId: org.id, quoteId: quote.id, status: "CONFIRMED" } });
  const lineA = await prisma.orderLine.create({ data: { orderId: order.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 } });
  const lineB = await prisma.orderLine.create({ data: { orderId: order.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 } });

  const article = await prisma.article.create({
    data: { organizationId: org.id, title: "Shared piece 2", createdByUserId: user.id, createdByRole: "BUYER" },
  });
  const placementA = await prisma.articlePlacement.create({ data: { orderLineId: lineA.id, articleId: article.id } });
  const placementB = await prisma.articlePlacement.create({ data: { orderLineId: lineB.id, articleId: article.id } });

  // Retract A only.
  await prisma.articlePlacement.update({
    where: { id: placementA.id },
    data: { retractedAt: new Date(), retractedBy: user.id, retractionNote: "test" },
  });
  const reloadedB = await prisma.articlePlacement.findUniqueOrThrow({ where: { id: placementB.id } });
  assert.equal(reloadedB.retractedAt, null);

  // Now go FINAL — both unlocked placements (B is unlocked; A is retracted
  // but that's an independent field, not a lock state) should lock to it.
  const finalVersion = await prisma.contentAsset.create({
    data: { articleId: article.id, version: 1, body: "final text", status: "FINAL" },
  });
  const { lockPlacementsOnFinal } = await import("@/lib/writers/placement");
  await lockPlacementsOnFinal(article.id, finalVersion.id);

  const lockedA = await prisma.articlePlacement.findUniqueOrThrow({ where: { id: placementA.id } });
  const lockedB = await prisma.articlePlacement.findUniqueOrThrow({ where: { id: placementB.id } });
  assert.equal(lockedA.lockedAssetId, finalVersion.id);
  assert.equal(lockedB.lockedAssetId, finalVersion.id);
  assert.notEqual(lockedA.retractedAt, null); // retraction survives the lock

  await prisma.articlePlacement.deleteMany({ where: { id: { in: [placementA.id, placementB.id] } } });
  await prisma.contentAsset.delete({ where: { id: finalVersion.id } });
  await prisma.article.delete({ where: { id: article.id } });
  await prisma.orderLine.deleteMany({ where: { id: { in: [lineA.id, lineB.id] } } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.quote.delete({ where: { id: quote.id } });
  await prisma.request.delete({ where: { id: request.id } });
  await prisma.plan.delete({ where: { id: plan.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("canWriteArticle: journalist assigned via WriterProfile.userId can write, another journalist cannot", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Test Org 3", type: "ADVERTISER" } });
  const writerUser = await prisma.user.create({
    data: { email: `it-writer-${Date.now()}@example.com`, role: "CONTENT" },
  });
  const otherWriterUser = await prisma.user.create({
    data: { email: `it-writer2-${Date.now()}@example.com`, role: "CONTENT" },
  });
  const writerProfile = await prisma.writerProfile.create({ data: { userId: writerUser.id } });

  const article = await prisma.article.create({
    data: {
      organizationId: org.id,
      title: "Journalist piece",
      createdByUserId: writerUser.id,
      createdByRole: "DESK",
      assignedWriterId: writerProfile.id,
    },
  });

  const loaded = await prisma.article.findUnique({
    where: { id: article.id },
    select: { organizationId: true, assignedWriter: { select: { userId: true } } },
  });
  assert.ok(loaded);

  assert.equal(
    canWriteArticle({
      role: "CONTENT",
      userId: writerUser.id,
      organizationId: loaded.organizationId,
      scopeOrgIds: [],
      assignedWriterUserId: loaded.assignedWriter?.userId ?? null,
    }),
    true,
  );
  assert.equal(
    canWriteArticle({
      role: "CONTENT",
      userId: otherWriterUser.id,
      organizationId: loaded.organizationId,
      scopeOrgIds: [],
      assignedWriterUserId: loaded.assignedWriter?.userId ?? null,
    }),
    false,
  );

  await prisma.article.delete({ where: { id: article.id } });
  await prisma.writerProfile.delete({ where: { id: writerProfile.id } });
  await prisma.user.delete({ where: { id: writerUser.id } });
  await prisma.user.delete({ where: { id: otherWriterUser.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});
