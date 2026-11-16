import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { setEmailAdapter } from "@/lib/notify";
import {
  createPriceRequest,
  resendPriceRequest,
  sendPriceRequest,
  unsubscribePriceRequest,
} from "./requests";

// DB-mutating integration test — skipped unless RUN_DB_IT=1, and only
// against a DISPOSABLE database. A price request is outreach: it must obey
// the suppression list, go out once, and carry an opt-out.
const RUN_DB_IT = process.env.RUN_DB_IT === "1";

if (!RUN_DB_IT) {
  test("price-request send integration (skipped — set RUN_DB_IT=1)", { skip: true }, () => {});
} else {
  const REF = `prs-it-${Date.now()}`;
  const EMAIL = `${REF}@publisher-test.example`;
  let userId: string;
  let publisherId: string;
  let titleId: string;
  let contactId: string;
  type Mail = { to: string; text: string; headers?: Record<string, string> };
  let sent: Mail[] = [];
  let prevCap: string | undefined;

  before(async () => {
    prevCap = process.env.OUTREACH_DAILY_CAP;
    process.env.OUTREACH_DAILY_CAP = "100000";
    setEmailAdapter(async (m) => {
      sent.push(m as Mail);
    });
    const market = await prisma.market.findFirstOrThrow({ where: { code: "NO" } });
    const user = await prisma.user.findFirstOrThrow({ where: { role: { in: ["DESK", "SUPERADMIN"] } } });
    userId = user.id;
    const pub = await prisma.publisher.create({
      data: { name: `PRS publisher ${REF}`, countryCode: market.code, marketId: market.id },
    });
    publisherId = pub.id;
    const title = await prisma.title.create({
      data: {
        name: `PRS title ${REF}`,
        slug: REF,
        publisherId: pub.id,
        countryCode: market.code,
        marketId: market.id,
        type: "Avis",
        category: "general-news",
      },
    });
    titleId = title.id;
    const contact = await prisma.salesContact.create({
      data: { publisherId: pub.id, email: EMAIL, name: "PRS Contact" },
    });
    contactId = contact.id;
  });

  after(async () => {
    if (prevCap === undefined) delete process.env.OUTREACH_DAILY_CAP;
    else process.env.OUTREACH_DAILY_CAP = prevCap;
    await prisma.priceRequest.deleteMany({ where: { titleId } });
    await prisma.outreachSuppression.deleteMany({ where: { email: EMAIL } });
    await prisma.salesContact.deleteMany({ where: { id: contactId } });
    await prisma.title.deleteMany({ where: { id: titleId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
  });

  const make = () => createPriceRequest({ titleId, salesContactId: contactId, requestedById: userId });

  test("sends once, with an opt-out link and List-Unsubscribe headers", async () => {
    sent = [];
    const req = await make();
    const results = await Promise.all([
      sendPriceRequest({ priceRequestId: req.id, actorId: userId }),
      sendPriceRequest({ priceRequestId: req.id, actorId: userId }),
    ]);
    assert.equal(results.filter((r) => "sent" in r).length, 1, "a double submit mails once");
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, new RegExp(`/price-request/${req.token}/unsubscribe`));
    assert.match(sent[0].headers?.["List-Unsubscribe"] ?? "", /\/unsubscribe>$/);
    assert.equal(sent[0].headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");

    // A plain second send is refused; only a deliberate resend goes out.
    assert.deepEqual(await sendPriceRequest({ priceRequestId: req.id, actorId: userId }), {
      skipped: "already_sent",
    });
    assert.deepEqual(await resendPriceRequest({ priceRequestId: req.id, actorId: userId }), { sent: true });
    assert.equal(sent.length, 2);
  });

  test("a failed send releases the claim", async () => {
    const req = await make();
    setEmailAdapter(async () => {
      throw new Error("smtp down");
    });
    await assert.rejects(sendPriceRequest({ priceRequestId: req.id, actorId: userId }), /smtp down/);
    assert.equal((await prisma.priceRequest.findUniqueOrThrow({ where: { id: req.id } })).sentAt, null);
    setEmailAdapter(async (m) => {
      sent.push(m as Mail);
    });
  });

  test("unsubscribe suppresses the address: no further price request is mailed", async () => {
    sent = [];
    const first = await make();
    await unsubscribePriceRequest(first.token);
    assert.ok((await prisma.priceRequest.findUniqueOrThrow({ where: { id: first.id } })).cancelledAt);
    assert.ok(await prisma.outreachSuppression.findUnique({ where: { email: EMAIL } }));

    const second = await make();
    assert.deepEqual(await sendPriceRequest({ priceRequestId: second.id, actorId: userId }), {
      skipped: "suppressed",
    });
    assert.deepEqual(await resendPriceRequest({ priceRequestId: second.id, actorId: userId }), {
      skipped: "suppressed",
    });
    assert.equal(sent.length, 0);
  });
}
