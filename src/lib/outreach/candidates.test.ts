import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { approveCandidate, rejectCandidate, bulkApproveAboveConfidence } from "./candidates";

// These are DB-mutating integration tests. `bulkApproveAboveConfidence` runs
// GLOBALLY (it has no publisher scope), so running this file approves/rejects
// and writes real rows in whatever database DATABASE_URL points at. They are
// SKIPPED unless RUN_DB_IT=1 is set, and must only be run against a DISPOSABLE
// test database — NEVER production. (A prior run against prod, where before()
// failed and left publisherId undefined, caused a `where:{publisherId:undefined}`
// mass-delete of every ContactCandidate. Hence the guards below.)
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("candidates integration tests (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  let publisherId: string | undefined;
  let userId: string;
  let titleId: string;
  let candidateId: string;

  before(async () => {
    const market = await prisma.market.findFirstOrThrow();
    const user = await prisma.user.findFirstOrThrow({ where: { role: { in: ["DESK", "SUPERADMIN"] } } });
    userId = user.id;
    // Unique per-run name so a leftover row from an interrupted run can never
    // cause a unique-constraint failure (which would leave publisherId unset).
    const pub = await prisma.publisher.create({
      data: { name: `Test Publisher (outreach) ${Date.now()}`, countryCode: market.code, marketId: market.id },
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
    // Guard: never run a `where: { publisherId }` delete with an undefined id —
    // Prisma would treat it as no filter and delete every row in the table.
    if (!publisherId) return;
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
      data: { publisherId: publisherId!, email: "reject@test.no", sourceUrl: "x", confidence: 10 },
    });
    await rejectCandidate({ candidateId: cand.id, reviewedById: userId, reason: "garbage" });
    const updated = await prisma.contactCandidate.findUniqueOrThrow({ where: { id: cand.id } });
    assert.equal(updated.status, "REJECTED");
    assert.equal(updated.reviewedById, userId);
  });

  test("bulkApproveAboveConfidence approves all PENDING with confidence >= threshold", async () => {
    await prisma.contactCandidate.create({
      data: { publisherId: publisherId!, email: "low@test.no", sourceUrl: "x", confidence: 30 },
    });
    await prisma.contactCandidate.create({
      data: { publisherId: publisherId!, email: "high@test.no", sourceUrl: "x", confidence: 95 },
    });
    const result = await bulkApproveAboveConfidence({ minConfidence: 80, reviewedById: userId });
    assert.ok(result.approved >= 1);

    const high = await prisma.contactCandidate.findFirstOrThrow({ where: { publisherId, email: "high@test.no" } });
    assert.equal(high.status, "APPROVED");
    const low = await prisma.contactCandidate.findFirstOrThrow({ where: { publisherId, email: "low@test.no" } });
    assert.equal(low.status, "PENDING");
  });
}
