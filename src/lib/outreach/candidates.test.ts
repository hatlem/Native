import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { approveCandidate, rejectCandidate, bulkApproveAboveConfidence } from "./candidates";

let publisherId: string;
let userId: string;
let titleId: string;
let candidateId: string;

before(async () => {
  const market = await prisma.market.findFirstOrThrow();
  const user = await prisma.user.findFirstOrThrow({ where: { role: { in: ["DESK", "SUPERADMIN"] } } });
  userId = user.id;
  const pub = await prisma.publisher.create({
    data: { name: "Test Publisher (outreach)", countryCode: market.code, marketId: market.id },
  });
  publisherId = pub.id;
  const title = await prisma.title.create({
    data: {
      name: "Test Title (outreach)",
      slug: `test-title-outreach-${Date.now()}`,
      publisherId,
      countryCode: market.code,
      marketId: market.id,
      type: "Avis",
      category: "general-news",
    },
  });
  titleId = title.id;
  const cand = await prisma.contactCandidate.create({
    data: {
      publisherId,
      email: "approve-me@test.no",
      name: "Test Person",
      role: "Salgssjef",
      sourceUrl: "https://test.no/annonsere",
      confidence: 90,
    },
  });
  candidateId = cand.id;
});

after(async () => {
  await prisma.contactCandidate.deleteMany({ where: { publisherId } });
  await prisma.salesContactTitle.deleteMany({ where: { title: { publisherId } } });
  await prisma.salesContact.deleteMany({ where: { publisherId } });
  await prisma.title.deleteMany({ where: { publisherId } });
  await prisma.publisher.delete({ where: { id: publisherId } });
});

test("approveCandidate creates SalesContact + attaches all publisher's titles + marks approved", async () => {
  const result = await approveCandidate({ candidateId, reviewedById: userId });
  assert.ok(result.salesContactId);

  const sc = await prisma.salesContact.findUniqueOrThrow({ where: { id: result.salesContactId } });
  assert.equal(sc.email, "approve-me@test.no");
  assert.equal(sc.publisherId, publisherId);

  const linked = await prisma.salesContactTitle.findMany({ where: { salesContactId: sc.id } });
  assert.equal(linked.length, 1);
  assert.equal(linked[0].titleId, titleId);
  assert.equal(linked[0].isPrimary, true);

  const cand = await prisma.contactCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  assert.equal(cand.status, "APPROVED");
  assert.equal(cand.salesContactId, sc.id);
});

test("rejectCandidate sets status REJECTED + records reviewer", async () => {
  const cand = await prisma.contactCandidate.create({
    data: { publisherId, email: "reject@test.no", sourceUrl: "x", confidence: 10 },
  });
  await rejectCandidate({ candidateId: cand.id, reviewedById: userId, reason: "garbage" });
  const after = await prisma.contactCandidate.findUniqueOrThrow({ where: { id: cand.id } });
  assert.equal(after.status, "REJECTED");
  assert.equal(after.reviewedById, userId);
});

test("bulkApproveAboveConfidence approves all PENDING with confidence >= threshold", async () => {
  await prisma.contactCandidate.create({
    data: { publisherId, email: "low@test.no", sourceUrl: "x", confidence: 30 },
  });
  await prisma.contactCandidate.create({
    data: { publisherId, email: "high@test.no", sourceUrl: "x", confidence: 95 },
  });
  const result = await bulkApproveAboveConfidence({ minConfidence: 80, reviewedById: userId });
  assert.ok(result.approved >= 1);

  const high = await prisma.contactCandidate.findFirstOrThrow({ where: { publisherId, email: "high@test.no" } });
  assert.equal(high.status, "APPROVED");
  const low = await prisma.contactCandidate.findFirstOrThrow({ where: { publisherId, email: "low@test.no" } });
  assert.equal(low.status, "PENDING");
});
