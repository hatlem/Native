import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { canWriteArticle } from "@/lib/writers/access";
import { ensureArticleForLine } from "@/lib/writers/article";

// This suite exercises the DB-backed paths that access.ts's unit tests
// (Task 2) can't cover: Prisma relations, the unique orderLineId
// constraint, and the writer-assignment auto-creation hook (Task 5).

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
  assert.equal(article.orderLineId, null);

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

test("an order line can be linked to at most one article (unique constraint)", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Test Org 2", type: "ADVERTISER" } });
  const user = await prisma.user.create({
    data: { email: `it-buyer2-${Date.now()}@example.com`, role: "BUYER", organizationId: org.id },
  });
  // Quote hangs off Request -> Plan (no direct organizationId on Quote in
  // the current schema), so build the full chain to get a real, valid
  // Quote/Order pair rather than hand-waving the FKs.
  const plan = await prisma.plan.create({ data: { organizationId: org.id } });
  const request = await prisma.request.create({
    data: { organizationId: org.id, planId: plan.id, status: "DRAFT" },
  });
  const quote = await prisma.quote.create({
    data: { requestId: request.id, status: "ACCEPTED", currency: "EUR", subtotal: 0, vatPct: 0, total: 0 },
  });
  const order = await prisma.order.create({
    data: { organizationId: org.id, quoteId: quote.id, status: "CONFIRMED" },
  });
  const line = await prisma.orderLine.create({
    data: { orderId: order.id, kind: "INVENTORY", authorshipMode: "BUYER_SUPPLIED", quantity: 1, lineTotal: 0 },
  });

  const first = await prisma.article.create({
    data: { organizationId: org.id, title: "First", createdByUserId: user.id, createdByRole: "BUYER", orderLineId: line.id },
  });

  await assert.rejects(() =>
    prisma.article.create({
      data: { organizationId: org.id, title: "Second", createdByUserId: user.id, createdByRole: "BUYER", orderLineId: line.id },
    }),
  );

  await prisma.article.delete({ where: { id: first.id } });
  await prisma.orderLine.delete({ where: { id: line.id } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.quote.delete({ where: { id: quote.id } });
  await prisma.request.delete({ where: { id: request.id } });
  await prisma.plan.delete({ where: { id: plan.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.organization.delete({ where: { id: org.id } });
});

test("ensureArticleForLine is idempotent: concurrent first-writes yield one Article", async () => {
  const org = await prisma.organization.create({ data: { name: "IT Test Org 4", type: "ADVERTISER" } });
  const user = await prisma.user.create({
    data: { email: `it-desk-${Date.now()}@example.com`, role: "DESK" },
  });
  const writerUser = await prisma.user.create({
    data: { email: `it-writer3-${Date.now()}@example.com`, role: "CONTENT" },
  });
  const writerProfile = await prisma.writerProfile.create({ data: { userId: writerUser.id } });
  const plan = await prisma.plan.create({ data: { organizationId: org.id } });
  const request = await prisma.request.create({
    data: { organizationId: org.id, planId: plan.id, status: "DRAFT" },
  });
  const quote = await prisma.quote.create({
    data: { requestId: request.id, status: "ACCEPTED", currency: "EUR", subtotal: 0, vatPct: 0, total: 0 },
  });
  const order = await prisma.order.create({
    data: { organizationId: org.id, quoteId: quote.id, status: "CONFIRMED" },
  });
  const line = await prisma.orderLine.create({
    data: { orderId: order.id, kind: "INVENTORY", authorshipMode: "NATIVESPIN_PRODUCED", quantity: 1, lineTotal: 0 },
  });

  const args = {
    orderLineId: line.id,
    organizationId: org.id,
    title: "Untitled article",
    createdByUserId: user.id,
    createdByRole: "DESK" as const,
  };
  // Two racing callers (desk staffing a writer + desk composing a draft)
  // must collapse onto the single row the unique orderLineId allows.
  const [a, b] = await Promise.all([
    ensureArticleForLine(args),
    ensureArticleForLine(args),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(await prisma.article.count({ where: { orderLineId: line.id } }), 1);

  // A re-assignment repoints the existing row rather than creating one.
  const reassigned = await ensureArticleForLine({ ...args, assignedWriterId: writerProfile.id });
  assert.equal(reassigned.id, a.id);
  assert.equal(reassigned.assignedWriterId, writerProfile.id);

  // Omitting assignedWriterId leaves the current writer untouched.
  const untouched = await ensureArticleForLine(args);
  assert.equal(untouched.assignedWriterId, writerProfile.id);

  await prisma.article.delete({ where: { id: a.id } });
  await prisma.orderLine.delete({ where: { id: line.id } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.quote.delete({ where: { id: quote.id } });
  await prisma.request.delete({ where: { id: request.id } });
  await prisma.plan.delete({ where: { id: plan.id } });
  await prisma.writerProfile.delete({ where: { id: writerProfile.id } });
  await prisma.user.delete({ where: { id: writerUser.id } });
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
