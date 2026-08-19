import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { logQuote } from "@/lib/pricing/quotes";
import { storeRateCardDocument } from "@/lib/ratecard/store";
import { publicationCompleteness } from "@/lib/ratecard/extract";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. The R2 round-trip inside
// storeRateCardDocument additionally needs R2_* creds; that single test
// self-skips when they're absent so the rest still runs DB-only.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";
const HAS_R2 =
  !!process.env.R2_ACCOUNT_ID &&
  !!process.env.R2_ACCESS_KEY_ID &&
  !!process.env.R2_SECRET_ACCESS_KEY &&
  !!process.env.R2_BUCKET;

if (!RUN_DB_IT) {
  test("rate-card store integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  let userId: string;
  let publisherId: string;
  let titleId: string;

  before(async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const user = await prisma.user.create({
      data: { email: `rc-it-${Date.now()}@example.com`, role: "SUPERADMIN" },
    });
    userId = user.id;
    const pub = await prisma.publisher.create({
      data: {
        name: `RC-IT publisher ${Date.now()}`,
        countryCode: market.code,
        marketId: market.id,
      },
    });
    publisherId = pub.id;
    const title = await prisma.title.create({
      data: {
        name: "RC-IT Title",
        slug: `rc-it-${Date.now()}`,
        publisherId: pub.id,
        countryCode: market.code,
        marketId: market.id,
        category: "business",
      },
    });
    titleId = title.id;
  });

  after(async () => {
    await prisma.priceQuote.deleteMany({ where: { recordedById: userId } });
    await prisma.rateCardDocument.deleteMany({ where: { createdById: userId } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
    // notifyDesk/notifyOrg from parallel suites can stamp Notification rows on
    // transient test users mid-run — clear them or the user delete FK-faults.
    await prisma.notification.deleteMany({ where: { user: { id: userId } } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  test("logQuote persists priceUnit and rateCardDocumentId", async () => {
    const doc = await prisma.rateCardDocument.create({
      data: {
        titleId,
        publisherId,
        fileName: "mediakit.pdf",
        objectKey: `rate-cards/test/${Date.now()}-mediakit.pdf`,
        createdById: userId,
        ocrStatus: "DONE",
        ocrText: "Annonsørinnhold 25000 NOK · CPM 450",
      },
    });

    const quote = await logQuote({
      rateCardDocumentId: doc.id,
      draftProductType: "NATIVE_DISPLAY",
      draftProductName: "Banner",
      price: 450,
      priceUnit: "CPM",
      currency: "NOK",
      recordedById: userId,
    });

    const saved = await prisma.priceQuote.findUniqueOrThrow({ where: { id: quote.id } });
    assert.equal(saved.priceUnit, "CPM");
    assert.equal(saved.rateCardDocumentId, doc.id);
    assert.equal(Number(saved.price), 450);
  });

  test("logQuote defaults priceUnit to FLAT", async () => {
    const quote = await logQuote({
      draftProductType: "NATIVE_ARTICLE",
      draftProductName: "Native",
      price: 25000,
      currency: "NOK",
      recordedById: userId,
    });
    const saved = await prisma.priceQuote.findUniqueOrThrow({ where: { id: quote.id } });
    assert.equal(saved.priceUnit, "FLAT");
  });

  test("deleting a rate-card document nulls the quote link but keeps the quote", async () => {
    const doc = await prisma.rateCardDocument.create({
      data: {
        titleId,
        fileName: "kit2.pdf",
        objectKey: `rate-cards/test/${Date.now()}-kit2.pdf`,
        createdById: userId,
      },
    });
    const quote = await logQuote({
      rateCardDocumentId: doc.id,
      draftProductType: "ADVERTORIAL",
      draftProductName: "Advertorial",
      price: 18000,
      currency: "NOK",
      recordedById: userId,
    });

    await prisma.rateCardDocument.delete({ where: { id: doc.id } });

    const survivor = await prisma.priceQuote.findUnique({ where: { id: quote.id } });
    assert.ok(survivor, "quote survives document deletion");
    assert.equal(survivor!.rateCardDocumentId, null, "link is nulled (ON DELETE SET NULL)");
  });

  test("publicationCompleteness reflects captured advertiser-content quote", async () => {
    // Fresh title so earlier quotes don't interfere.
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const title = await prisma.title.create({
      data: {
        name: "RC-IT Completeness",
        slug: `rc-it-comp-${Date.now()}`,
        publisherId,
        countryCode: market.code,
        marketId: market.id,
        category: "business",
      },
    });

    const before = await publicationCompleteness(title.id);
    assert.ok(before);
    assert.equal(before!.complete, false);
    assert.ok(before!.missing.includes("own_content_allowed"));

    const doc = await prisma.rateCardDocument.create({
      data: { titleId: title.id, fileName: "k.pdf", objectKey: `rate-cards/test/${Date.now()}.pdf`, createdById: userId },
    });
    await logQuote({
      rateCardDocumentId: doc.id,
      draftProductType: "NATIVE_ARTICLE",
      draftProductName: "Native",
      price: 25000,
      currency: "NOK",
      includedText: "Produksjon + forside",
      recordedById: userId,
    });
    // Need to link the quote to the title — the quote above links only to
    // the document. Attach it to a contact log on the title so the
    // completeness query (which walks product/request/contactLog) sees it.
    const contact = await prisma.contactLog.create({
      data: { titleId: title.id, channel: "EMAIL", direction: "INBOUND", contactedById: userId },
    });
    await logQuote({
      contactLogId: contact.id,
      rateCardDocumentId: doc.id,
      draftProductType: "NATIVE_ARTICLE",
      draftProductName: "Native",
      price: 25000,
      currency: "NOK",
      includedText: "Produksjon + forside",
      recordedById: userId,
    });
    await prisma.title.update({
      where: { id: title.id },
      data: { ownContentAllowed: "WITH_APPROVAL" },
    });

    const after = await publicationCompleteness(title.id);
    assert.equal(after!.complete, true, "complete once priced native quote + own-content known");

    // Cleanup this extra title.
    await prisma.priceQuote.deleteMany({ where: { contactLogId: contact.id } });
    await prisma.contactLog.deleteMany({ where: { titleId: title.id } });
    await prisma.rateCardDocument.deleteMany({ where: { titleId: title.id } });
    await prisma.title.deleteMany({ where: { id: title.id } });
  });

  test("storeRateCardDocument round-trips through R2 (skipped without R2_* env)", { skip: !HAS_R2 }, async () => {
    const doc = await storeRateCardDocument({
      buffer: Buffer.from("%PDF-1.4\n% test rate card\n%%EOF"),
      fileName: "store-it.pdf",
      contentType: "application/pdf",
      titleId,
      publisherId,
      source: "test:it",
      actorId: userId,
    });
    assert.ok(doc.objectKey.startsWith("rate-cards/"));
    assert.equal(doc.ocrStatus, "PENDING");
    assert.equal(doc.titleId, titleId);
  });
}
