import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { buildRateCardCampaign } from "./campaign";

let userId: string;
let publisherIds: string[] = [];
let titleIds: string[] = [];
let salesContactIds: string[] = [];

before(async () => {
  const market = await prisma.market.findFirstOrThrow();
  const user = await prisma.user.findFirstOrThrow({ where: { role: { in: ["DESK", "SUPERADMIN"] } } });
  userId = user.id;

  // Two publishers share the same sales-house email; a third has a unique one.
  for (let i = 0; i < 3; i++) {
    const pub = await prisma.publisher.create({
      data: { name: `Outreach Pub ${i}-${Date.now()}`, countryCode: market.code, marketId: market.id },
    });
    publisherIds.push(pub.id);
    const title = await prisma.title.create({
      data: {
        name: `Outreach Title ${i}-${Date.now()}`,
        slug: `outreach-title-${i}-${Date.now()}`,
        publisherId: pub.id,
        countryCode: market.code,
        marketId: market.id,
        type: "Avis",
        category: "general-news",
      },
    });
    titleIds.push(title.id);
    const email = i < 2 ? `shared@saleshouse-test.example` : `solo@publisher-test.example`;
    const sc = await prisma.salesContact.create({
      data: { publisherId: pub.id, email, name: `Contact ${i}` },
    });
    salesContactIds.push(sc.id);
    await prisma.salesContactTitle.create({
      data: { salesContactId: sc.id, titleId: title.id, isPrimary: true },
    });
  }
});

after(async () => {
  await prisma.rateCardRequestTitle.deleteMany({ where: { titleId: { in: titleIds } } });
  await prisma.rateCardRequest.deleteMany({ where: { recipientEmail: { in: ["shared@saleshouse-test.example", "solo@publisher-test.example"] } } });
  await prisma.salesContactTitle.deleteMany({ where: { titleId: { in: titleIds } } });
  await prisma.salesContact.deleteMany({ where: { id: { in: salesContactIds } } });
  await prisma.title.deleteMany({ where: { id: { in: titleIds } } });
  await prisma.publisher.deleteMany({ where: { id: { in: publisherIds } } });
});

test("buildRateCardCampaign groups 2 contacts sharing email -> 1 request with both titles", async () => {
  const result = await buildRateCardCampaign({ createdById: userId, scopeContactIds: salesContactIds });
  assert.equal(result.requests_created, 2);

  const shared = await prisma.rateCardRequest.findFirstOrThrow({
    where: { recipientEmail: "shared@saleshouse-test.example" },
    include: { titles: true },
  });
  assert.equal(shared.titles.length, 2);
  assert.equal(shared.sentCount, 0);
  assert.equal(shared.locale.length, 2);

  const solo = await prisma.rateCardRequest.findFirstOrThrow({
    where: { recipientEmail: "solo@publisher-test.example" },
    include: { titles: true },
  });
  assert.equal(solo.titles.length, 1);
});

test("buildRateCardCampaign is idempotent — second run creates 0 new requests", async () => {
  const result = await buildRateCardCampaign({ createdById: userId, scopeContactIds: salesContactIds });
  assert.equal(result.requests_created, 0);
});

test("buildRateCardCampaign skips suppressed emails", async () => {
  await prisma.outreachSuppression.upsert({
    where: { email: "solo@publisher-test.example" },
    update: {},
    create: { email: "solo@publisher-test.example", reason: "unsubscribe" },
  });
  try {
    await prisma.rateCardRequest.deleteMany({ where: { recipientEmail: "solo@publisher-test.example" } });
    const result = await buildRateCardCampaign({ createdById: userId, scopeContactIds: salesContactIds });
    // shared@ already exists; solo@ is suppressed
    assert.equal(result.requests_created, 0);
    const solo = await prisma.rateCardRequest.findFirst({ where: { recipientEmail: "solo@publisher-test.example" } });
    assert.equal(solo, null);
  } finally {
    await prisma.outreachSuppression.delete({ where: { email: "solo@publisher-test.example" } });
  }
});
