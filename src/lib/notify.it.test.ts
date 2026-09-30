import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { OrgType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyOrg, notifyUser, setEmailAdapter, emailAdapter, type EmailMessage } from "@/lib/notify";
import { draftNoticeContext, notifyChangesRequested } from "@/lib/content/review-notices";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. Every notice is written per recipient:
//   1. an org member with a stored language reads it (inbox + email) in that
//      language, one without falls back to the org's market — links too;
//   2. a buyer's change request reaches the assigned writer, in the writer's
//      language, with the buyer's comment (BUG-desk-lifecycle-r2-5).
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("notify integration (skipped — set RUN_DB_IT=1 with a disposable DB)", { skip: true }, () => {});
} else {
  const REF = `notify-it-${Date.now()}`;
  const sent: EmailMessage[] = [];
  const original = emailAdapter;
  let orgId: string;
  let norwegianId: string;
  let swedishId: string;
  let writerUserId: string;
  let articleId: string;
  let assetId: string;

  before(async () => {
    setEmailAdapter(async (msg) => {
      sent.push(msg);
    });
    const org = await prisma.organization.create({
      data: { name: `Notify IT ${REF}`, type: OrgType.ADVERTISER, marketCode: "NO" },
    });
    orgId = org.id;
    norwegianId = (
      await prisma.user.create({ data: { email: `${REF}-no@example.test`, organizationId: org.id } })
    ).id;
    swedishId = (
      await prisma.user.create({
        data: { email: `${REF}-sv@example.test`, organizationId: org.id, locale: "sv" },
      })
    ).id;
    const writer = await prisma.user.create({
      data: { email: `${REF}-writer@example.test`, role: "CONTENT", locale: "no" },
    });
    writerUserId = writer.id;
    const profile = await prisma.writerProfile.create({ data: { userId: writer.id } });
    const article = await prisma.article.create({
      data: {
        organizationId: org.id,
        title: "Slik får håndverkere kontroll på flåten",
        createdByUserId: norwegianId,
        createdByRole: "BUYER",
        assignedWriterId: profile.id,
      },
    });
    articleId = article.id;
    assetId = (
      await prisma.contentAsset.create({
        data: { articleId: article.id, version: 2, status: "IN_REVIEW", body: "x" },
      })
    ).id;
  });

  after(async () => {
    setEmailAdapter(original);
    const users = [norwegianId, swedishId, writerUserId];
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.notification.deleteMany({ where: { link: { contains: articleId } } });
    await prisma.contentAsset.deleteMany({ where: { articleId } });
    await prisma.article.deleteMany({ where: { id: articleId } });
    await prisma.writerProfile.deleteMany({ where: { userId: writerUserId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  test("each org member reads the notice in their own language, email included", async () => {
    sent.length = 0;
    await notifyOrg(orgId, {
      kind: "INVOICE_ISSUED",
      template: {
        key: "invoiceIssued",
        params: {
          planName: "Q4",
          invoiceId: "inv-it",
          total: 150610,
          currency: "NOK",
          dueAt: "2026-10-30T00:00:00.000Z",
        },
      },
    });
    const no = await prisma.notification.findFirstOrThrow({ where: { userId: norwegianId } });
    const sv = await prisma.notification.findFirstOrThrow({ where: { userId: swedishId } });
    // No stored language: the org's market (NO).
    assert.equal(no.title, "Faktura utstedt: Q4");
    assert.equal(no.link, "/no/invoices/inv-it");
    assert.equal(sv.title, "Faktura utfärdad: Q4");
    assert.equal(sv.link, "/sv/invoices/inv-it");
    assert.equal(no.messageKey, "invoiceIssued");

    const noMail = sent.find((m) => m.to === `${REF}-no@example.test`);
    const svMail = sent.find((m) => m.to === `${REF}-sv@example.test`);
    assert.ok(noMail && svMail);
    assert.equal(noMail.subject, "Faktura utstedt: Q4");
    assert.match(noMail.text, /Åpne i NativeSpin: \S+\/no\/invoices\/inv-it/);
    assert.match(svMail.text, /Öppna i NativeSpin: \S+\/sv\/invoices\/inv-it/);
    assert.ok(!/View:/.test(noMail.text + svMail.text));
  });

  test("a user with no stored language gets the caller's fallback", async () => {
    await prisma.user.update({ where: { id: writerUserId }, data: { locale: null } });
    await notifyUser(
      writerUserId,
      {
        kind: "ASSET_REVIEW",
        template: {
          key: "writerAssigned",
          params: { titleName: "Der Spiegel", productType: "NATIVE_ARTICLE", orderLineId: "line-it" },
        },
      },
      { fallbackLocale: "de", email: false },
    );
    const row = await prisma.notification.findFirstOrThrow({
      where: { userId: writerUserId, messageKey: "writerAssigned" },
    });
    assert.equal(row.title, "Neuer Auftrag: Der Spiegel");
    assert.equal(row.link, "/de/writer/lines/line-it");
    await prisma.user.update({ where: { id: writerUserId }, data: { locale: "no" } });
  });

  test("a buyer's change request reaches the assigned writer with the comment", async () => {
    sent.length = 0;
    const ctx = await draftNoticeContext(assetId);
    assert.ok(ctx);
    assert.equal(ctx.writer?.userId, writerUserId);
    await notifyChangesRequested(ctx, "client", "Legg til et avsnitt om drivstoff");

    const row = await prisma.notification.findFirstOrThrow({
      where: { userId: writerUserId, messageKey: "writerChangesRequested" },
    });
    assert.equal(row.title, "Endringer ønsket: Slik får håndverkere kontroll på flåten");
    assert.match(row.body ?? "", /Kunden har sendt versjon 2/);
    assert.match(row.body ?? "", /«Legg til et avsnitt om drivstoff»/);
    const mail = sent.find((m) => m.to === `${REF}-writer@example.test`);
    assert.ok(mail, "the writer is emailed too");
    // The desk's copy carries the comment as well.
    const desk = sent.find((m) => m.to !== `${REF}-writer@example.test`);
    if (desk) assert.match(desk.text, /Legg til et avsnitt om drivstoff/);
  });
}
