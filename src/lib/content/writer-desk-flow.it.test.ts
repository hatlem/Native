import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { emailAdapter, setEmailAdapter, type EmailMessage } from "@/lib/notify";
import { supersedeOlderVersions } from "./versions";
import { specFailuresForSubmission } from "@/lib/spec-check-runner";
import { activateQuoteProducts } from "@/lib/pricing/quotes";
import { confirmProductPrice, PublisherRatesError } from "@/lib/publisher-rates";
import { sendMetricsRequestsNow } from "@/lib/campaign-reporting/campaign";

// DB integration for the writer/desk fixes — skipped unless RUN_DB_IT=1,
// and only against a DISPOSABLE database (needs the seeded NO market).
//   - supersede: an approved version retires older open versions only
//   - spec gate: a failing draft is reported for submission; a fixed one isn't
//   - catalog standard: an unpriced (blueprint) product is never activated or
//     "confirmed" at 0
//   - metrics now: requests are built + sent at once, with an absolute link
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("writer/desk flow integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const stamp = Date.now();
  let actorId = "";
  let publisherId = "";
  let titleId = "";
  let productId = "";
  let orgId = "";
  let orderId = "";
  let lineId = "";
  let articleId = "";
  let placementId = "";
  const sent: EmailMessage[] = [];
  const originalAdapter = emailAdapter;
  const originalAuthUrl = process.env.AUTH_URL;

  before(async () => {
    setEmailAdapter(async (msg) => {
      sent.push(msg);
    });
    process.env.AUTH_URL = "https://nativespin.example";

    const actor = await prisma.user.create({
      data: { email: `wdux-it-${stamp}@test.invalid`, role: "SUPERADMIN" },
    });
    actorId = actor.id;
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const pub = await prisma.publisher.create({
      data: { name: `WDUX-IT publisher ${stamp}`, countryCode: "NO", marketId: market.id },
    });
    publisherId = pub.id;
    const title = await prisma.title.create({
      data: {
        name: "WDUX-IT Title",
        slug: `wdux-it-${stamp}`,
        publisherId: pub.id,
        countryCode: "NO",
        marketId: market.id,
        category: "business",
        active: true,
      },
    });
    titleId = title.id;
    const product = await prisma.product.create({
      data: {
        titleId: title.id,
        type: "NATIVE_ARTICLE",
        name: "WDUX-IT native article",
        basePrice: 10000,
        currency: "NOK",
        confirmedAt: new Date(),
        spec: { create: { wordCountMin: 5, imagesMin: 1, disclosureLabel: "Annonsørinnhold" } },
      },
    });
    productId = product.id;

    const org = await prisma.organization.create({
      data: { name: `WDUX-IT org ${stamp}`, type: "ADVERTISER", marketCode: "NO" },
    });
    orgId = org.id;
    const plan = await prisma.plan.create({ data: { organizationId: org.id, name: "WDUX-IT plan" } });
    const req = await prisma.request.create({
      data: { organizationId: org.id, planId: plan.id, status: "CLOSED" },
    });
    const quote = await prisma.quote.create({
      data: { requestId: req.id, status: "ACCEPTED", currency: "NOK", subtotal: 10000, vatPct: 25, total: 12500 },
    });
    const order = await prisma.order.create({
      data: {
        organizationId: org.id,
        quoteId: quote.id,
        status: "LIVE",
        flightEndDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    });
    orderId = order.id;
    const line = await prisma.orderLine.create({
      data: {
        orderId: order.id,
        productId: product.id,
        lineTotal: 10000,
        authorshipMode: "NATIVESPIN_PRODUCED",
      },
    });
    lineId = line.id;
    await prisma.publisherBooking.create({
      data: { orderLineId: line.id, publisherId: pub.id, titleId: title.id, status: "CONFIRMED" },
    });
    const sc = await prisma.salesContact.create({
      data: { publisherId: pub.id, name: "WDUX contact", email: `wdux-it-contact-${stamp}@publisher.invalid` },
    });
    await prisma.salesContactTitle.create({ data: { salesContactId: sc.id, titleId: title.id, isPrimary: true } });

    const article = await prisma.article.create({
      data: { organizationId: org.id, title: "WDUX-IT Title", createdByUserId: actorId, createdByRole: "DESK" },
    });
    articleId = article.id;
    const placement = await prisma.articlePlacement.create({
      data: { orderLineId: line.id, articleId: article.id },
    });
    placementId = placement.id;
  });

  after(async () => {
    setEmailAdapter(originalAdapter);
    if (originalAuthUrl === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = originalAuthUrl;
    await prisma.metricsRequest.deleteMany({ where: { orderId } });
    await prisma.articlePlacement.deleteMany({ where: { articleId } });
    await prisma.contentAsset.deleteMany({ where: { articleId } });
    await prisma.article.deleteMany({ where: { id: articleId } });
    await prisma.publisherBooking.deleteMany({ where: { orderLineId: lineId } });
    await prisma.orderLine.deleteMany({ where: { orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.salesContactTitle.deleteMany({ where: { titleId } });
    await prisma.salesContact.deleteMany({ where: { publisherId } });
    await prisma.spec.deleteMany({ where: { product: { titleId } } });
    await prisma.priceRule.deleteMany({ where: { product: { titleId } } });
    await prisma.product.deleteMany({ where: { titleId } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
  });

  test("approving v4 supersedes older open versions, never approved/final ones", async () => {
    const a = await prisma.article.create({
      data: { organizationId: orgId, title: "Supersede", createdByUserId: actorId, createdByRole: "DESK" },
    });
    const statuses = ["FINAL", "IN_REVIEW", "APPROVED"] as const;
    for (const [i, status] of statuses.entries()) {
      await prisma.contentAsset.create({ data: { articleId: a.id, version: i + 1, status, body: "x" } });
    }
    await prisma.contentAsset.create({ data: { articleId: a.id, version: 4, status: "APPROVED", body: "x" } });
    // v2 was left "in review" when v4 got approved.
    const n = await supersedeOlderVersions(prisma, { articleId: a.id, version: 4 });
    assert.equal(n, 1);
    const rows = await prisma.contentAsset.findMany({
      where: { articleId: a.id },
      orderBy: { version: "asc" },
      select: { status: true },
    });
    assert.deepEqual(rows.map((r) => r.status), ["FINAL", "SUPERSEDED", "APPROVED", "APPROVED"]);
    await prisma.contentAsset.deleteMany({ where: { articleId: a.id } });
    await prisma.article.delete({ where: { id: a.id } });
  });

  test("spec gate: a draft without the disclosure label is blocked; with it, it passes", async () => {
    const bad = await prisma.contentAsset.create({
      data: { articleId, version: 1, status: "DRAFT", body: "A draft that forgot its label entirely." },
    });
    const failing = await specFailuresForSubmission({ articleId, assetId: bad.id });
    assert.equal(failing.length, 1);
    assert.deepEqual(failing[0].evaluation.result.failures, [
      { rule: "disclosure", label: "Annonsørinnhold" },
      // The format's image minimum is enforced too, not just listed.
      { rule: "tooFewImages", images: 0, min: 1 },
    ]);
    // The check persisted its verdict for the desk.
    const p1 = await prisma.articlePlacement.findUniqueOrThrow({ where: { id: placementId } });
    assert.equal(p1.specPassed, false);

    const good = await prisma.contentAsset.create({
      data: {
        articleId,
        version: 2,
        status: "DRAFT",
        body: "Annonsørinnhold — a draft that is labelled properly.\n\n![The fleet](https://cdn.example.com/fleet.jpg)",
      },
    });
    assert.deepEqual(await specFailuresForSubmission({ articleId, assetId: good.id }), []);
    const p2 = await prisma.articlePlacement.findUniqueOrThrow({ where: { id: placementId } });
    assert.equal(p2.specPassed, true);
  });

  test("an unpriced (blueprint) product is never activated or confirmed at 0", async () => {
    const skeleton = await prisma.product.create({
      data: {
        titleId,
        type: "NATIVE_DISPLAY",
        name: "WDUX-IT — Native display",
        basePrice: 0,
        currency: "NOK",
        active: false,
        bookable: false,
        confirmedSource: "blueprint",
      },
    });
    await assert.rejects(
      confirmProductPrice({ publisherId, productId: skeleton.id, actorUserId: actorId }),
      (err: unknown) => err instanceof PublisherRatesError && err.code === "invalid-price",
    );
    // Even with a stray confirmation stamp, a 0 price never goes live.
    await prisma.product.update({ where: { id: skeleton.id }, data: { confirmedAt: new Date() } });
    await activateQuoteProducts({ actorUserId: actorId, titleId });
    const after = await prisma.product.findUniqueOrThrow({ where: { id: skeleton.id } });
    assert.equal(after.active, false);
    assert.equal(after.bookable, false);
  });

  test("send metrics request now: builds and sends immediately, with an absolute link", async () => {
    sent.length = 0;
    const result = await sendMetricsRequestsNow({ orderId, actorId });
    assert.ok(result.ok);
    assert.equal(result.created, 1);
    assert.equal(result.sent, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /https:\/\/nativespin\.example\/no\/campaign-report\//);
    assert.doesNotMatch(sent[0].text, /localhost:3000/);
    // Idempotent: nothing new to build or send.
    const again = await sendMetricsRequestsNow({ orderId, actorId });
    assert.ok(again.ok && again.created === 0 && again.sent === 0);
  });

  test("send metrics request now refuses before the flight has ended", async () => {
    await prisma.order.update({
      where: { id: orderId },
      data: { flightEndDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
    });
    const result = await sendMetricsRequestsNow({ orderId, actorId });
    assert.deepEqual(result, { ok: false, reason: "not_ended" });
  });
}
