import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createOrderFromQuote, QuoteNotAcceptableError } from "@/lib/commerce/accept-quote";
import { quoteFingerprint } from "@/lib/commerce/quote-offer";
import { sendDraftQuotes } from "@/lib/commerce/quote-lifecycle";
import { updateQuoteLineNote, updateQuoteLinePrice } from "@/lib/commerce/quote-edits";
import { discardQuoteRevision, reviseQuote } from "@/lib/commerce/quote-revision";
import { acceptableQuoteWhere, buyerVisibleQuoteWhere } from "@/lib/commerce/quote-validity";
import { reconcileExpiredQuotes } from "@/lib/commerce/quote-expiry";
import { lineOrder } from "@/lib/commerce/line-order";
import { loadQuotePdfData, QuoteSupersededError } from "@/lib/pdf/quote-pdf-data";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only against
// a DISPOSABLE database. A sent quote is immutable; changes go out as a
// revision (lib/commerce/quote-revision.ts). Drives the same lib calls the
// desk's server actions make (they need a session and throw NEXT_REDIRECT):
//   1. every line edit on a SENT quote is refused and changes nothing
//   2. revise → edit → send: the old quote is SUPERSEDED (not acceptable,
//      never swept to EXPIRED, no new PDF/DOCX), the new one is acceptable,
//      and the buyer is notified exactly once, with the new total
//   3. an accepted quote can't be revised; a revision whose predecessor was
//      accepted meanwhile can't be sent; a double "Revise" opens one revision
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("quote revision integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const REF = `qr-it-${Date.now()}`;
  const DAY = 86_400_000;
  let publisherId = "";
  let productId = "";
  let orgId = "";
  let buyerId = "";
  let deskId = "";

  before(async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const pub = await prisma.publisher.create({
      data: { name: `QR-IT publisher ${REF}`, countryCode: market.code, marketId: market.id },
    });
    publisherId = pub.id;
    const title = await prisma.title.create({
      data: {
        name: "QR-IT Title",
        slug: REF,
        publisherId,
        countryCode: market.code,
        marketId: market.id,
        category: "business",
        active: true,
      },
    });
    productId = (
      await prisma.product.create({
        data: { titleId: title.id, type: "NATIVE_ARTICLE", name: "QR-IT native", basePrice: 10000, currency: "NOK" },
      })
    ).id;
    orgId = (
      await prisma.organization.create({
        data: { name: `QR-IT org ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO" },
      })
    ).id;
    buyerId = (await prisma.user.create({ data: { email: `${REF}@example.test`, organizationId: orgId } })).id;
    // Org notices go to ACTIVE seats (lib/notify.ts), like access does.
    await prisma.membership.create({ data: { userId: buyerId, organizationId: orgId, role: "ADMIN", canCommit: true } });
    deskId = (await prisma.user.create({ data: { email: `${REF}-desk@example.test`, role: "DESK" } })).id;
  });

  after(async () => {
    const quoteWhere = { request: { organizationId: orgId } };
    await prisma.notification.deleteMany({ where: { userId: { in: [buyerId, deskId] } } });
    await prisma.publisherBooking.deleteMany({ where: { orderLine: { order: { organizationId: orgId } } } });
    await prisma.contentBrief.deleteMany({ where: { orderLine: { order: { organizationId: orgId } } } });
    await prisma.orderLine.deleteMany({ where: { order: { organizationId: orgId } } });
    await prisma.order.deleteMany({ where: { organizationId: orgId } });
    await prisma.quoteLine.deleteMany({ where: { quote: quoteWhere } });
    // Revisions reference their predecessor: newest first.
    await prisma.quote.deleteMany({ where: { ...quoteWhere, previousQuoteId: { not: null } } });
    await prisma.quote.deleteMany({ where: quoteWhere });
    await prisma.request.deleteMany({ where: { organizationId: orgId } });
    await prisma.planItem.deleteMany({ where: { plan: { organizationId: orgId } } });
    await prisma.plan.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { actor: deskId } });
    await prisma.user.deleteMany({ where: { id: { in: [buyerId, deskId] } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.title.deleteMany({ where: { publisherId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
  });

  // A request with one quote the desk has priced and SENT: a 15 000 placement
  // and a 5 000 content fee (20 000 + 25% VAT = 25 000).
  async function seedSentQuote() {
    const plan = await prisma.plan.create({
      data: {
        organizationId: orgId,
        name: "QR-IT Winter",
        items: { create: [{ productId, quantity: 1 }] },
      },
    });
    const request = await prisma.request.create({
      data: { organizationId: orgId, planId: plan.id, status: "IN_REVIEW" },
    });
    const quote = await prisma.quote.create({
      data: {
        requestId: request.id,
        status: "DRAFT",
        currency: "NOK",
        subtotal: 20000,
        vatPct: 25,
        total: 25000,
        lines: {
          create: [
            { kind: "INVENTORY", productId, description: "QR-IT placement", quantity: 1, unitCost: 10000, marginPct: 50, lineTotal: 15000, position: 0, customerNote: "Front page" },
            { kind: "CONTENT_FEE", productId: null, description: "QR-IT production", quantity: 1, unitCost: 0, marginPct: 100, lineTotal: 5000, position: 1 },
          ],
        },
      },
      include: { lines: { orderBy: lineOrder() } },
    });
    const sent = await sendDraftQuotes({
      requestId: request.id,
      validUntil: new Date(Date.now() + 14 * DAY),
      actorUserId: deskId,
    });
    assert.equal(sent.outcome, "sent");
    return { requestId: request.id, planId: plan.id, quoteId: quote.id, lineIds: quote.lines.map((l) => l.id) };
  }

  const quoteNotices = (requestId: string) =>
    prisma.notification.findMany({
      where: { userId: buyerId, kind: "QUOTE_READY", link: `/no/requests/${requestId}` },
      orderBy: { createdAt: "asc" },
    });

  const accept = async (quoteId: string, planId: string) => {
    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: quoteId },
      include: { lines: { orderBy: lineOrder() } },
    });
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId }, include: { items: true } });
    return prisma.$transaction((tx) =>
      createOrderFromQuote(tx, {
        organizationId: orgId,
        quote: { id: quoteId, lines: quote.lines },
        offerFingerprint: quoteFingerprint(quote),
        plan,
      }),
    );
  };

  test("every line edit on a SENT quote is refused and changes nothing", async () => {
    const { requestId, quoteId, lineIds } = await seedSentQuote();
    const before = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { lines: true } });

    const reprice = await updateQuoteLinePrice({
      requestId,
      quoteId,
      lineId: lineIds[0],
      change: { intent: "set", lineTotal: 9000 },
      actorUserId: deskId,
    });
    assert.deepEqual(reprice, { outcome: "locked" });
    const onRequest = await updateQuoteLinePrice({
      requestId,
      quoteId,
      lineId: lineIds[0],
      change: { intent: "onRequest" },
      actorUserId: deskId,
    });
    assert.deepEqual(onRequest, { outcome: "locked" });
    assert.deepEqual(
      await updateQuoteLineNote({ requestId, quoteId, lineId: lineIds[0], note: "Changed" }),
      { outcome: "locked" },
    );

    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { lines: true } });
    assert.equal(Number(after.total), Number(before.total));
    assert.deepEqual(
      after.lines.map((l) => [l.id, Number(l.lineTotal), l.priceOnRequest, l.customerNote, l.priceSetAt]),
      before.lines.map((l) => [l.id, Number(l.lineTotal), l.priceOnRequest, l.customerNote, l.priceSetAt]),
    );
  });

  test("a DRAFT's lines still edit, and the totals follow", async () => {
    const { requestId, quoteId } = await seedSentQuote();
    const revised = await reviseQuote({ quoteId, actorUserId: deskId });
    assert.equal(revised.outcome, "created");
    const draftId = (revised as { quoteId: string }).quoteId;
    const line = await prisma.quoteLine.findFirstOrThrow({ where: { quoteId: draftId, kind: "INVENTORY" } });

    const res = await updateQuoteLinePrice({
      requestId,
      quoteId: draftId,
      lineId: line.id,
      change: { intent: "set", lineTotal: 11000 },
      actorUserId: deskId,
    });
    assert.equal(res.outcome, "updated");
    const draft = await prisma.quote.findUniqueOrThrow({ where: { id: draftId } });
    assert.equal(Number(draft.subtotal), 16000);
    assert.equal(Number(draft.total), 20000);
    assert.deepEqual(
      await updateQuoteLineNote({ requestId, quoteId: draftId, lineId: line.id, note: "Weekend" }),
      { outcome: "updated", hadNote: true },
    );
  });

  test("revise → send: the old quote is superseded, the new one acceptable, one notice with the new total", async () => {
    const { requestId, planId, quoteId } = await seedSentQuote();
    assert.equal((await quoteNotices(requestId)).length, 1, "the original send notified once");

    const revised = await reviseQuote({ quoteId, actorUserId: deskId });
    assert.equal(revised.outcome, "created");
    const revisionId = (revised as { quoteId: string }).quoteId;
    const revision = await prisma.quote.findUniqueOrThrow({
      where: { id: revisionId },
      include: { lines: { orderBy: lineOrder() } },
    });
    assert.equal(revision.status, "DRAFT");
    assert.equal(revision.revision, 2);
    assert.equal(revision.previousQuoteId, quoteId);
    assert.equal(revision.validUntil, null);
    assert.deepEqual(
      revision.lines.map((l) => [l.kind, Number(l.lineTotal), l.position, l.customerNote]),
      [
        ["INVENTORY", 15000, 0, "Front page"],
        ["CONTENT_FEE", 5000, 1, null],
      ],
      "the revision copies the lines exactly as the buyer saw them",
    );

    // While it is a draft: the buyer can't see it, the old quote is still the offer.
    const visible = await prisma.quote.findMany({
      where: { requestId, ...buyerVisibleQuoteWhere() },
      select: { id: true },
    });
    assert.deepEqual(visible.map((q) => q.id), [quoteId]);
    assert.equal(await prisma.quote.count({ where: { id: quoteId, ...acceptableQuoteWhere() } }), 1);

    // Reprice the placement 15 000 → 10 000: 15 000 + 25% = 18 750.
    await updateQuoteLinePrice({
      requestId,
      quoteId: revisionId,
      lineId: revision.lines[0].id,
      change: { intent: "set", lineTotal: 10000 },
      actorUserId: deskId,
    });
    const sent = await sendDraftQuotes({
      requestId,
      validUntil: new Date("2031-11-30T23:59:59.999Z"),
      actorUserId: deskId,
    });
    assert.deepEqual(sent, { outcome: "sent", quoteIds: [revisionId] });

    const old = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    assert.equal(old.status, "SUPERSEDED");
    assert.ok(old.supersededAt);
    assert.equal(await prisma.quote.count({ where: { id: quoteId, ...acceptableQuoteWhere() } }), 0);
    assert.equal(await prisma.quote.count({ where: { id: revisionId, ...acceptableQuoteWhere() } }), 1);

    // Exactly one new notice, in the org's language, with the NEW total.
    const notices = await quoteNotices(requestId);
    assert.equal(notices.length, 2, "one for the original send, one for the revision — never more");
    assert.equal(notices[1].title, "Tilbudet ditt er revidert (revisjon 2): QR-IT Winter");
    assert.match(notices[1].body ?? "", /18\s750/u);
    assert.doesNotMatch(notices[1].body ?? "", /25\s000/u);

    // A second send click sends nothing and notifies nobody.
    assert.deepEqual(
      await sendDraftQuotes({ requestId, validUntil: new Date(Date.now() + DAY), actorUserId: deskId }),
      { outcome: "none" },
    );
    assert.equal((await quoteNotices(requestId)).length, 2);

    // The superseded quote can't be accepted, even by a click that raced the send…
    await assert.rejects(accept(quoteId, planId), QuoteNotAcceptableError);
    assert.equal(await prisma.order.count({ where: { quoteId } }), 0);
    // …is never swept to EXPIRED, even long after its window…
    await prisma.quote.update({ where: { id: quoteId }, data: { validUntil: new Date(Date.now() - DAY) } });
    await reconcileExpiredQuotes({ requestId });
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).status, "SUPERSEDED");
    // …and no new customer document is rendered from it.
    await assert.rejects(
      loadQuotePdfData(quoteId, { name: null, email: "desk@example.test" }, "no"),
      QuoteSupersededError,
    );
    const pdf = await loadQuotePdfData(revisionId, { name: null, email: "desk@example.test" }, "no");
    assert.equal(pdf.revision?.number, 2, "the revision's document says which revision it is");

    // The revision is the offer now, and accepting it works.
    const order = await accept(revisionId, planId);
    const orderLines = await prisma.orderLine.findMany({ where: { orderId: order.orderId }, orderBy: lineOrder() });
    assert.deepEqual(orderLines.map((l) => Number(l.lineTotal)), [10000, 5000]);
  });

  test("an accepted quote can't be revised", async () => {
    const { quoteId, planId } = await seedSentQuote();
    await accept(quoteId, planId);
    const res = await reviseQuote({ quoteId, actorUserId: deskId });
    assert.deepEqual(res, { outcome: "not-revisable", status: "ACCEPTED" });
    assert.equal(await prisma.quote.count({ where: { previousQuoteId: quoteId } }), 0);
  });

  test("a DRAFT is edited, not revised", async () => {
    const { quoteId } = await seedSentQuote();
    const revised = await reviseQuote({ quoteId, actorUserId: deskId });
    const draftId = (revised as { quoteId: string }).quoteId;
    assert.deepEqual(await reviseQuote({ quoteId: draftId, actorUserId: deskId }), {
      outcome: "not-revisable",
      status: "DRAFT",
    });
  });

  test("a double 'Revise' opens one revision", async () => {
    const { quoteId } = await seedSentQuote();
    const [a, b] = await Promise.all([
      reviseQuote({ quoteId, actorUserId: deskId }),
      reviseQuote({ quoteId, actorUserId: deskId }),
    ]);
    const ids = [a, b].map((r) => ("quoteId" in r ? r.quoteId : null));
    assert.equal(ids[0], ids[1], "both clicks land on the same revision");
    assert.deepEqual([a.outcome, b.outcome].sort(), ["created", "exists"]);
    assert.equal(await prisma.quote.count({ where: { previousQuoteId: quoteId } }), 1);
  });

  test("if the buyer accepts while the revision is drafted, the revision can't be sent", async () => {
    const { requestId, quoteId, planId } = await seedSentQuote();
    const revised = await reviseQuote({ quoteId, actorUserId: deskId });
    const revisionId = (revised as { quoteId: string }).quoteId;
    await accept(quoteId, planId);
    const noticesBefore = (await quoteNotices(requestId)).length;

    const res = await sendDraftQuotes({ requestId, validUntil: new Date(Date.now() + 7 * DAY), actorUserId: deskId });
    assert.deepEqual(res, { outcome: "predecessor-closed", quoteIds: [revisionId] });
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).status, "ACCEPTED");
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: revisionId } })).status, "DRAFT");
    assert.equal((await quoteNotices(requestId)).length, noticesBefore, "the buyer hears nothing");

    // The desk discards it; the accepted quote is untouched.
    assert.deepEqual(await discardQuoteRevision({ quoteId: revisionId, actorUserId: deskId }), {
      outcome: "discarded",
      previousQuoteId: quoteId,
    });
    assert.equal(await prisma.quote.count({ where: { id: revisionId } }), 0);
    assert.equal(await prisma.quoteLine.count({ where: { quoteId: revisionId } }), 0);
  });

  test("discarding only removes an unsent revision; the predecessor stays the offer", async () => {
    const { requestId, quoteId } = await seedSentQuote();
    // Not a revision (the original, sent quote): refused.
    assert.deepEqual(await discardQuoteRevision({ quoteId, actorUserId: deskId }), { outcome: "not-discardable" });
    const revised = await reviseQuote({ quoteId, actorUserId: deskId });
    const revisionId = (revised as { quoteId: string }).quoteId;
    await discardQuoteRevision({ quoteId: revisionId, actorUserId: deskId });
    assert.equal(await prisma.quote.count({ where: { id: quoteId, ...acceptableQuoteWhere() } }), 1);
    // …and it can be revised again.
    assert.equal((await reviseQuote({ quoteId, actorUserId: deskId })).outcome, "created");
    // A SENT revision is an offer the buyer holds: not discardable.
    await sendDraftQuotes({ requestId, validUntil: new Date(Date.now() + 7 * DAY), actorUserId: deskId });
    const sentRevision = await prisma.quote.findFirstOrThrow({ where: { previousQuoteId: quoteId } });
    assert.equal(sentRevision.status, "SENT");
    assert.deepEqual(
      await discardQuoteRevision({ quoteId: sentRevision.id, actorUserId: deskId }),
      { outcome: "not-discardable" },
    );
  });

  test("an EXPIRED quote is revised the same way; a revision of the revision counts up", async () => {
    const { requestId, quoteId } = await seedSentQuote();
    await prisma.quote.update({ where: { id: quoteId }, data: { status: "EXPIRED" } });
    const r2 = await reviseQuote({ quoteId, actorUserId: deskId });
    assert.equal(r2.outcome, "created");
    await sendDraftQuotes({ requestId, validUntil: new Date(Date.now() + 7 * DAY), actorUserId: deskId });
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).status, "SUPERSEDED");

    const r2Id = (r2 as { quoteId: string }).quoteId;
    // The superseded one can't be revised again — revise the newest.
    assert.equal((await reviseQuote({ quoteId, actorUserId: deskId })).outcome, "exists");
    const r3 = await reviseQuote({ quoteId: r2Id, actorUserId: deskId });
    assert.equal(r3.outcome, "created");
    assert.equal((r3 as { revision: number }).revision, 3);
  });
}
