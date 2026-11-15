// The purchase journey, end to end through the real UI:
// sign-up → verification link → onboarding → catalog → plan → request →
// desk quote → buyer accepts → order → desk invoice → buyer invoice + PDF,
// then a second organisation tries every id-bearing URL the journey produced.
// See e2e/README.md for how to run it.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  APP_LOG,
  BASE_URL,
  DESK,
  E2E_PASSWORD,
  NAV_TIMEOUT_MS,
  RUN_TAG,
  cleanupRun,
  cookieHeader,
  createFreshBuyer,
  emailLink,
  get,
  goto,
  launchBrowser,
  mainText,
  orderableTitleSlug,
  sendQuoteViaUi,
  settle,
  signIn,
  submitRequestViaUi,
} from "./helpers.mjs";

// Sign-up checks that the address's domain has mail servers (a real DNS
// lookup), so the test needs a domain that resolves. Nothing is sent: the
// suite runs without RESEND_API_KEY and reads the mail from the app log.
const SIGNUP_DOMAIN = process.env.E2E_SIGNUP_DOMAIN || "nativespin.com";

let prisma;
let browser;
let buyerCtx;
let deskCtx;
let buyerPage;
let deskPage;
let buyer; // { email, password, orgName }
const ids = { requestId: "", quoteId: "", orderId: "", invoiceId: "", planId: "" };
let signedUpThroughUi = false;

before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point at the app's (disposable) database");
  prisma = new PrismaClient();
  browser = await launchBrowser();
  buyerCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  deskCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
});

after(async () => {
  await browser?.close();
  if (prisma) {
    await cleanupRun(prisma);
    await prisma.$disconnect();
  }
});

test("sign-up creates an account and the emailed link signs the user in", async (t) => {
  if (!APP_LOG) return t.skip("E2E_APP_LOG is not set: the verification link cannot be read");
  const email = `${RUN_TAG}-signup@${SIGNUP_DOMAIN}`;
  const orgName = `E2E signup ${RUN_TAG}`;
  const page = await buyerCtx.newPage();
  await goto(page, "/en/signup");
  const form = page.locator("form:has(input[name=orgName])");
  await form.locator("input[name=orgName]").waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(1500); // hydration: the submit must be the server action
  await form.locator("input[name=name]").fill("E2E Signup");
  await form.locator("input[name=orgName]").fill(orgName);
  await form.locator("input[name=email]").fill(email);
  await form.locator("summary").click();
  await form.locator("input[name=password]").fill(E2E_PASSWORD);
  await form.locator("button[type=submit], button:not([type])").first().click();
  try {
    await page.waitForURL((u) => u.pathname.includes("/check-email"), { timeout: 30_000 });
  } catch {
    const alert = (await form.locator("[role=alert]").allInnerTexts()).join(" ");
    await page.close();
    // No DNS here (sandboxes, air-gapped runners): the domain check cannot pass.
    if (/mail server/i.test(alert)) return t.skip(`sign-up's mail-domain lookup found no MX for ${SIGNUP_DOMAIN} (no DNS on this machine)`);
    assert.fail(`sign-up stayed on the form: ${alert || "no error shown"}`);
  }
  assert.ok(!page.url().includes(encodeURIComponent(email)) && !page.url().includes(email), "the address is not carried in the URL");

  const link = await emailLink(email, new RegExp(`${BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\S*magic-link/\\S+`));
  await page.goto(link, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  await settle(page);
  assert.ok(!/\/signin|\/check-email/.test(page.url()), `the link signs the user in (landed on ${page.url()})`);
  const row = await prisma.user.findUnique({ where: { email }, select: { emailVerifiedAt: true, organization: { select: { name: true } } } });
  assert.ok(row?.emailVerifiedAt, "the address is marked verified");
  buyer = { email, password: E2E_PASSWORD, orgName };
  buyerPage = page;
  signedUpThroughUi = true;
});

test("a new organisation completes onboarding before it can buy", async () => {
  if (!signedUpThroughUi) {
    // Sign-up was skipped above: continue with an account in the exact state
    // sign-up leaves behind (org without a billing market).
    buyer = await createFreshBuyer(prisma, "journey");
    buyerPage = await signIn(buyerCtx, buyer);
  }
  await goto(buyerPage, "/en/onboarding");
  const form = buyerPage.locator("form:has(select[name=market])");
  await form.locator("select[name=market]").waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  await buyerPage.waitForTimeout(1000);
  await form.locator("select[name=market]").selectOption("NO");
  await form.locator("button[type=submit], button:not([type])").first().click();
  await buyerPage.waitForURL((u) => !/\/onboarding$/.test(u.pathname), { timeout: NAV_TIMEOUT_MS });
  const org = await prisma.organization.findFirst({ where: { name: buyer.orgName }, select: { marketCode: true } });
  assert.equal(org?.marketCode, "NO", "the billing market is stored");
  // Once onboarded, the page no longer asks.
  await goto(buyerPage, "/en/onboarding");
  await settle(buyerPage);
  assert.equal(await buyerPage.locator("select[name=market]").count(), 0, "onboarding is asked once");
});

test("the buyer adds a placement to the plan and submits a request", async () => {
  const slug = await orderableTitleSlug(prisma);
  // The signed-in catalog lists titles and links through to them.
  await goto(buyerPage, "/en/catalog");
  await buyerPage.locator(`main a[href*="/catalog/"]`).first().waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  ids.requestId = await submitRequestViaUi(buyerPage, slug, `E2E brief ${RUN_TAG}: treasury software for finance teams.`);
  const request = await prisma.request.findUnique({ where: { id: ids.requestId }, select: { status: true, planId: true, organization: { select: { name: true } } } });
  assert.equal(request?.status, "SUBMITTED");
  assert.equal(request?.organization.name, buyer.orgName);
  ids.planId = request.planId;
  // It shows up in the buyer's list.
  await goto(buyerPage, "/en/requests?tab=all");
  assert.ok(await buyerPage.locator(`main a[href*="${ids.requestId}"]`).count(), "the request is listed under Requests");
});

test("the desk prices the request and sends a firm quote", async () => {
  deskPage = await signIn(deskCtx, DESK);
  // The desk queue lists the new request.
  await goto(deskPage, `/en/desk/requests?q=${encodeURIComponent(RUN_TAG)}`);
  assert.ok(await deskPage.locator(`main a[href*="/desk/${ids.requestId}"]`).count(), "the desk request index finds it by search");
  await sendQuoteViaUi(deskPage, ids.requestId, ["4690", "1000"]);
  const quote = await prisma.quote.findFirst({ where: { requestId: ids.requestId }, orderBy: { createdAt: "desc" } });
  assert.equal(quote?.status, "SENT");
  assert.equal(quote.vatTreatment, "DOMESTIC", "a Norwegian buyer is quoted domestic VAT");
  assert.equal(Number(quote.vatPct), 25);
  assert.equal(Number(quote.subtotal), 5690);
  assert.equal(Number(quote.total), 7112.5, "VAT is exact to the øre: 5 690 + 25 % = 7 112.50");
  ids.quoteId = quote.id;
});

test("the buyer sees the firm quote, downloads it and accepts", async () => {
  await goto(buyerPage, `/en/requests/${ids.requestId}`);
  const text = await mainText(buyerPage);
  assert.match(text, /5,690/, "subtotal shown");
  assert.match(text, /7,112\.50/, "total shown with its decimals");
  // Internal economics never reach the buyer.
  assert.doesNotMatch(text, /margin/i, "no margin on the buyer's quote");
  const cookie = await cookieHeader(buyerCtx);
  const docx = await get(`/api/export/quote-docx/${ids.quoteId}?locale=en`, { cookie });
  assert.equal(docx.status, 200);
  assert.match(docx.headers.get("content-type") ?? "", /officedocument|msword/);
  const pdf = await get(`/api/export/quote-pdf/${ids.quoteId}?locale=en`, { cookie });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get("content-type") ?? "", /application\/pdf/);

  await buyerPage.locator("form:has(input[name=offer]) button").first().click();
  await buyerPage.locator(`a[href*="/orders/"]`).first().waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  const order = await prisma.order.findFirst({ where: { quoteId: ids.quoteId } });
  assert.ok(order, "accepting the quote created the order");
  assert.equal(order.status, "CONFIRMED");
  ids.orderId = order.id;
  const res = await goto(buyerPage, `/en/orders/${ids.orderId}`);
  assert.equal(res.status(), 200);
});

test("accepting twice does not create a second order", async () => {
  const count = await prisma.order.count({ where: { quoteId: ids.quoteId } });
  assert.equal(count, 1);
  await goto(buyerPage, `/en/requests/${ids.requestId}`);
  assert.equal(await buyerPage.locator("form:has(input[name=offer])").count(), 0, "the accept control is gone once accepted");
});

test("the desk delivers the order and issues the invoice", async () => {
  await goto(deskPage, `/en/desk/orders/${ids.orderId}`);
  // CONFIRMED → IN_PRODUCTION → SCHEDULED → LIVE → COMPLETED. The last two ask
  // the desk to confirm when no placement carries delivery evidence.
  for (let step = 0; step < 4; step++) {
    const advance = deskPage.locator("form:has(input[name=from])");
    await advance.waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
    const confirm = advance.locator("input[type=checkbox]");
    if (await confirm.count()) await confirm.first().check();
    const before = (await prisma.order.findUnique({ where: { id: ids.orderId }, select: { status: true } })).status;
    await advance.locator("button[type=submit], button:not([type])").first().click();
    await settle(deskPage);
    let now = before;
    for (let i = 0; i < 40 && now === before; i++) {
      await deskPage.waitForTimeout(250);
      now = (await prisma.order.findUnique({ where: { id: ids.orderId }, select: { status: true } })).status;
    }
    if (now === before) {
      // The confirmation box appears only after a first refused attempt.
      await goto(deskPage, deskPage.url().replace(BASE_URL, ""));
      step--;
      const box = deskPage.locator("form:has(input[name=from]) input[type=checkbox]");
      assert.ok(await box.count(), `the order stayed ${before} and no confirmation was offered`);
    }
  }
  assert.equal((await prisma.order.findUnique({ where: { id: ids.orderId } })).status, "COMPLETED");

  // The series counter holds the number the next invoice must take.
  const counterBefore = (await prisma.documentCounter.findUnique({ where: { series: "invoice" } }))?.next ?? 1;
  await goto(deskPage, `/en/desk/orders/${ids.orderId}`);
  await deskPage.getByRole("button", { name: /issue invoice/i }).click();
  await deskPage.locator(`a[href*="/invoices/"]`).first().waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  const invoice = await prisma.invoice.findFirst({ where: { orderId: ids.orderId } });
  assert.equal(invoice?.status, "ISSUED");
  assert.ok(Number.isInteger(invoice.number) && invoice.number > 0, "the invoice has a sequence number");
  assert.equal(invoice.vatTreatment, "DOMESTIC");
  assert.equal(Number(invoice.total), 7112.5);
  assert.ok(invoice.customerSnapshot, "the customer block is frozen on the invoice");
  ids.invoiceId = invoice.id;
  // The next number in the series, without a gap, and the counter moved by one.
  assert.equal(invoice.number, counterBefore, "the invoice took the next number in the series");
  assert.equal((await prisma.documentCounter.findUnique({ where: { series: "invoice" } })).next, counterBefore + 1);
  assert.equal((await prisma.order.findUnique({ where: { id: ids.orderId } })).status, "INVOICED");
});

test("the buyer sees the invoice with its number and VAT, and downloads the PDF", async () => {
  const invoice = await prisma.invoice.findUnique({ where: { id: ids.invoiceId } });
  await goto(buyerPage, `/en/invoices/${ids.invoiceId}`);
  const detail = await mainText(buyerPage);
  assert.match(detail, new RegExp(`#\\s?${invoice.number}\\b`), "the invoice page shows the sequence number");
  assert.match(detail, /VAT \(25%\)/);
  assert.match(detail, /1,422\.50/, "VAT amount");
  assert.match(detail, /7,112\.50/, "total");

  const cookie = await cookieHeader(buyerCtx);
  const pdf = await get(`/api/export/invoice-pdf/${ids.invoiceId}?locale=en`, { cookie });
  assert.equal(pdf.status, 200, "PDF download (needs the SELLER_* variables — see e2e/README.md)");
  assert.match(pdf.headers.get("content-type") ?? "", /application\/pdf/);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
});

test("the invoice list shows the same number as the invoice", async () => {
  const invoice = await prisma.invoice.findUnique({ where: { id: ids.invoiceId } });
  await goto(buyerPage, "/en/invoices");
  const row = buyerPage.locator(`main a[href$="/invoices/${ids.invoiceId}"]`).first();
  assert.equal((await row.innerText()).trim(), `#${invoice.number}`);
});

test("an emailed sign-in link signs an existing user in, once", async (t) => {
  if (!APP_LOG) return t.skip("E2E_APP_LOG is not set: the sign-in link cannot be read");
  const user = await createFreshBuyer(prisma, "magic", { onboarded: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await goto(page, "/en/signin");
  const form = page.locator("form:has(input[name=email]):not(:has(input[name=password])):not(:has(input[name=website]))").first();
  await form.locator("input[name=email]").waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(1500);
  await form.locator("input[name=email]").fill(user.email);
  await form.locator("button[type=submit], button:not([type])").first().click();
  await page.waitForURL((u) => u.pathname.includes("/check-email"), { timeout: NAV_TIMEOUT_MS });
  assert.ok(!page.url().includes(user.email), "the address is not carried in the URL");
  const link = await emailLink(user.email, /https?:\/\/\S*magic-link\/\S+/);
  await page.goto(link, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  await settle(page);
  assert.ok(!/\/signin|\/check-email/.test(page.url()), `signed in (landed on ${page.url()})`);
  assert.match(await cookieHeader(ctx), /authjs\.session-token=/);
  // The link is single-use: a second browser gets no session from it.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(link, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  await settle(page2);
  assert.doesNotMatch(await cookieHeader(ctx2), /authjs\.session-token=/, "a used link issues no session");
  await ctx.close();
  await ctx2.close();
});

test("another organisation gets 404/403 on every id the journey produced", async () => {
  const other = await createFreshBuyer(prisma, "outsider", { onboarded: true });
  const ctx = await browser.newContext();
  const page = await signIn(ctx, other);
  await page.close();
  const cookie = await cookieHeader(ctx);
  const list = await prisma.savedList.findFirst({ where: { organization: { name: buyer.orgName } }, select: { id: true } });
  const paths = [
    `/en/requests/${ids.requestId}`,
    `/en/orders/${ids.orderId}`,
    `/en/invoices/${ids.invoiceId}`,
    `/api/export/quote-pdf/${ids.quoteId}`,
    `/api/export/quote-docx/${ids.quoteId}`,
    `/api/export/invoice-pdf/${ids.invoiceId}`,
    `/api/export/campaign-report/${ids.orderId}`,
    ...(list ? [`/api/export/plan/${list.id}/pdf`, `/api/export/plan/${list.id}/csv`] : []),
    `/en/desk/${ids.requestId}`,
    `/en/desk/orders/${ids.orderId}`,
  ];
  for (const path of paths) {
    for (const headers of [{}, { RSC: "1" }]) {
      const res = await get(path, { cookie, headers, redirect: "follow" });
      const body = await res.text();
      const where = `${path} ${JSON.stringify(headers)}`;
      assert.ok(!body.includes(buyer.orgName), `${where} leaked the other organisation's name`);
      assert.ok(!body.includes(RUN_TAG + ": treasury"), `${where} leaked the brief`);
      if (!headers.RSC && !path.startsWith("/en/desk")) {
        const direct = await get(path, { cookie });
        assert.ok([403, 404].includes(direct.status), `${path} answered ${direct.status}, expected 403/404`);
      }
    }
  }
  // A plan that belongs to someone else never opens.
  if (list) {
    const res = await get(`/en/plan/open?list=${list.id}`, { cookie, redirect: "follow" });
    assert.ok(!(await res.text()).includes(buyer.orgName), "another organisation's plan does not open");
  }
  await ctx.close();
});

test("signed out, the same ids redirect to sign-in or are refused", async () => {
  for (const path of [`/en/requests/${ids.requestId}`, `/en/orders/${ids.orderId}`, `/en/invoices/${ids.invoiceId}`]) {
    const res = await get(path);
    assert.ok([307, 308].includes(res.status), `${path} → ${res.status}`);
    assert.match(res.headers.get("location") ?? "", /\/signin|\/requests/);
  }
  for (const path of [`/api/export/invoice-pdf/${ids.invoiceId}`, `/api/export/quote-pdf/${ids.quoteId}`]) {
    const res = await get(path);
    assert.ok([401, 403, 404, 307].includes(res.status), `${path} → ${res.status}`);
    assert.doesNotMatch(res.headers.get("content-type") ?? "", /application\/pdf/);
  }
});
