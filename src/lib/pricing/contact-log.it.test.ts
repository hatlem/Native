import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { logQuote } from "@/lib/pricing/quotes";
import {
  createContactLog,
  listForTitle,
  deleteContactLog,
} from "@/lib/pricing/contact-log";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("contact-log integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  let userId: string;
  let publisherId: string;
  let titleId: string;

  before(async () => {
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const user = await prisma.user.create({
      data: { email: `cl-it-${Date.now()}@example.com`, role: "SUPERADMIN" },
    });
    userId = user.id;
    const pub = await prisma.publisher.create({
      data: {
        name: `CL-IT publisher ${Date.now()}`,
        countryCode: market.code,
        marketId: market.id,
      },
    });
    publisherId = pub.id;
    const title = await prisma.title.create({
      data: {
        name: "CL-IT Title",
        slug: `cl-it-${Date.now()}`,
        publisherId: pub.id,
        countryCode: market.code,
        marketId: market.id,
        category: "business",
      },
    });
    titleId = title.id;
  });

  after(async () => {
    await prisma.priceQuote.deleteMany({ where: { contactLog: { titleId } } });
    await prisma.contactLog.deleteMany({ where: { titleId } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  test("create + list returns newest first with attributed offers", async () => {
    const first = await createContactLog({
      titleId,
      channel: "EMAIL",
      direction: "OUTBOUND",
      note: "Ba om priser",
      actorId: userId,
    });
    const second = await createContactLog({
      titleId,
      channel: "EMAIL",
      direction: "INBOUND",
      note: "Tilbud mottatt",
      actorId: userId,
    });

    await logQuote({
      contactLogId: second.id,
      draftProductType: "NATIVE_ARTICLE",
      draftProductName: "Native",
      price: 15000,
      currency: "NOK",
      includedText: "inkl. produksjon",
      recordedById: userId,
    });

    const list = await listForTitle(titleId);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, second.id, "newest (INBOUND) first");
    assert.equal(list[1].id, first.id);
    assert.equal(list[0].quotes.length, 1);
    assert.equal(list[0].quotes[0].includedText, "inkl. produksjon");
  });

  test("delete nulls the quote link but keeps the quote", async () => {
    const entry = await createContactLog({
      titleId,
      channel: "PHONE",
      direction: "INBOUND",
      actorId: userId,
    });
    const quote = await logQuote({
      contactLogId: entry.id,
      draftProductType: "NATIVE_ARTICLE",
      draftProductName: "Innstikk",
      price: 8000,
      currency: "NOK",
      recordedById: userId,
    });

    await deleteContactLog({ id: entry.id, actorId: userId });

    const stillThere = await prisma.priceQuote.findUnique({ where: { id: quote.id } });
    assert.ok(stillThere, "quote survives contact-log deletion");
    assert.equal(stillThere!.contactLogId, null, "link is nulled");
  });
}
