// Buyer self-service: decline a quote, withdraw a request, ask to cancel an
// order — each through the real UI, with the desk seeing the reason.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  DESK,
  NAV_TIMEOUT_MS,
  RUN_TAG,
  cleanupRun,
  createFreshBuyer,
  goto,
  launchBrowser,
  mainText,
  orderableTitleSlug,
  sendQuoteViaUi,
  settle,
  signIn,
  submitRequestViaUi,
} from "./helpers.mjs";

let prisma;
let browser;
let buyerCtx;
let deskCtx;
let buyerPage;
let deskPage;
let slug;
let withdrawnRequestId = "";

before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point at the app's (disposable) database");
  prisma = new PrismaClient();
  browser = await launchBrowser();
  deskCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  deskPage = await signIn(deskCtx, DESK);
  slug = await orderableTitleSlug(prisma);
});

after(async () => {
  await browser?.close();
  if (prisma) {
    await cleanupRun(prisma);
    await prisma.$disconnect();
  }
});

// Each test gets its own organisation: the checkout's double-submit guard
// would otherwise hand a quick second submit the previous test's request.
async function freshBuyerPage(label) {
  await buyerCtx?.close();
  buyerCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  buyerPage = await signIn(buyerCtx, await createFreshBuyer(prisma, label, { onboarded: true }));
}

// Open the <details> that holds a self-service form and submit it.
async function submitDetailsForm(page, formSelector, reason) {
  const form = page.locator(formSelector).first();
  await form.waitFor({ state: "attached", timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(1000);
  await form.locator("xpath=ancestor::details[1]/summary").click();
  await form.locator("textarea[name=reason]").fill(reason);
  await form.locator("button[type=submit], button:not([type])").first().click();
  await settle(page);
}

test("a buyer withdraws a request before it is quoted", async () => {
  await freshBuyerPage("withdraw");
  const requestId = await submitRequestViaUi(buyerPage, slug, `E2E withdraw ${RUN_TAG}`);
  const reason = `Budget moved to Q2 (${RUN_TAG})`;
  await submitDetailsForm(buyerPage, "form:has(input[name=requestId]):has(textarea[name=reason])", reason);
  let row;
  for (let i = 0; i < 40; i++) {
    row = await prisma.request.findUnique({ where: { id: requestId }, select: { status: true, withdrawnAt: true, withdrawReason: true } });
    if (row.withdrawnAt) break;
    await buyerPage.waitForTimeout(250);
  }
  assert.ok(row.withdrawnAt, "the request is marked withdrawn");
  assert.equal(row.withdrawReason, reason);
  assert.equal(row.status, "CLOSED");
  // The buyer can no longer act on it; the desk sees why.
  await goto(buyerPage, `/en/requests/${requestId}`);
  assert.equal(await buyerPage.locator("form:has(input[name=requestId]):has(textarea[name=reason])").count(), 0);
  await goto(deskPage, `/en/desk/${requestId}`);
  assert.ok((await mainText(deskPage)).includes(reason), "the desk sees the withdrawal reason");
  withdrawnRequestId = requestId;
});

test("the desk cannot quote a request the buyer withdrew", async () => {
  assert.ok(withdrawnRequestId, "requires the withdrawal test");
  await goto(deskPage, `/en/desk/${withdrawnRequestId}`);
  assert.equal(await deskPage.getByRole("button", { name: /generate quote/i }).count(), 0, "no Generate quote on a withdrawn request");
});

test("a buyer declines a sent quote with a reason", async () => {
  await freshBuyerPage("decline");
  const requestId = await submitRequestViaUi(buyerPage, slug, `E2E decline ${RUN_TAG}`);
  await sendQuoteViaUi(deskPage, requestId);
  const quote = await prisma.quote.findFirst({ where: { requestId, status: "SENT" } });
  assert.ok(quote, "the quote was sent");
  await goto(buyerPage, `/en/requests/${requestId}`);
  const reason = `Too expensive for this quarter (${RUN_TAG})`;
  await submitDetailsForm(buyerPage, "form:has(input[name=quoteId]):has(textarea[name=reason])", reason);
  let row;
  for (let i = 0; i < 40; i++) {
    row = await prisma.quote.findUnique({ where: { id: quote.id }, select: { status: true, declinedAt: true, declineReason: true } });
    if (row.declinedAt) break;
    await buyerPage.waitForTimeout(250);
  }
  assert.ok(row.declinedAt, "the quote is marked declined");
  assert.equal(row.status, "DECLINED");
  assert.equal(row.declineReason, reason);
  assert.equal(await prisma.order.count({ where: { quoteId: quote.id } }), 0, "no order came out of a declined quote");
  await goto(buyerPage, `/en/requests/${requestId}`);
  assert.equal(await buyerPage.locator("form:has(input[name=offer])").count(), 0, "a declined quote cannot be accepted");
  await goto(deskPage, `/en/desk/${requestId}`);
  assert.ok((await mainText(deskPage)).includes(reason), "the desk sees the decline reason");
});

test("a buyer asks to cancel an order; the desk decides", async () => {
  await freshBuyerPage("cancel");
  const requestId = await submitRequestViaUi(buyerPage, slug, `E2E cancel ${RUN_TAG}`);
  await sendQuoteViaUi(deskPage, requestId);
  await goto(buyerPage, `/en/requests/${requestId}`);
  await buyerPage.locator("form:has(input[name=offer]) button").first().click();
  await buyerPage.locator(`a[href*="/orders/"]`).first().waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  const order = await prisma.order.findFirst({ where: { quote: { requestId } } });
  assert.ok(order);
  await goto(buyerPage, `/en/orders/${order.id}`);
  const reason = `Campaign postponed (${RUN_TAG})`;
  const form = buyerPage.locator("form:has(input[name=orderId]):has(textarea[name=reason])").first();
  await form.waitFor({ state: "attached", timeout: NAV_TIMEOUT_MS });
  await buyerPage.waitForTimeout(1000);
  const summary = form.locator("xpath=ancestor::details[1]/summary");
  if (await summary.count()) await summary.click();
  await form.locator("textarea[name=reason]").fill(reason);
  await form.locator("button[type=submit], button:not([type])").first().click();
  await settle(buyerPage);
  await buyerPage.waitForTimeout(1500);
  const after = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(after.status, "CONFIRMED", "asking does not cancel the order by itself");
  await goto(deskPage, `/en/desk/orders/${order.id}`);
  assert.ok((await mainText(deskPage)).includes(reason), "the desk sees the cancellation request and its reason");
});
