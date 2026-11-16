// Team management: an admin invites a colleague, the colleague joins through
// the emailed link and sees the organisation's requests; once removed, they
// lose access.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  APP_LOG,
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
  orderableTitleSlug,
  settle,
  signIn,
  submitRequestViaUi,
} from "./helpers.mjs";

let prisma;
let browser;
let adminCtx;
let adminPage;
let admin;
let colleagueCtx;
let requestId = "";
const colleagueEmail = `${RUN_TAG}-colleague@e2e.nativespin.test`;

before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point at the app's (disposable) database");
  prisma = new PrismaClient();
  browser = await launchBrowser();
  adminCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  colleagueCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  admin = await createFreshBuyer(prisma, "team", { onboarded: true });
  adminPage = await signIn(adminCtx, admin);
  requestId = await submitRequestViaUi(adminPage, await orderableTitleSlug(prisma), `E2E team ${RUN_TAG}`);
});

after(async () => {
  await browser?.close();
  if (prisma) {
    await cleanupRun(prisma);
    await prisma.$disconnect();
  }
});

test("an admin invites a colleague, who joins and sees the organisation's requests", async (t) => {
  if (!APP_LOG) return t.skip("E2E_APP_LOG is not set: the invitation link cannot be read");
  await goto(adminPage, "/en/account");
  const invite = adminPage.locator("form:has(input[name=email]):has(select[name=role]):not(:has(input[name=userId]))").first();
  await invite.locator("input[name=email]").waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  await adminPage.waitForTimeout(1000);
  await invite.locator("input[name=email]").fill(colleagueEmail);
  await invite.locator("button[type=submit], button:not([type])").first().click();
  await adminPage.waitForURL((u) => u.search.includes("ok=invited") || u.search.includes("error="), { timeout: NAV_TIMEOUT_MS });
  assert.match(adminPage.url(), /ok=invited/, `the invitation was sent (${adminPage.url()})`);

  // Tokens are hashed at rest: the link exists only in the email.
  const stored = await prisma.orgInvite.findFirst({ where: { email: colleagueEmail } });
  assert.ok(stored, "the invitation is stored");
  const link = await emailLink(colleagueEmail, /https?:\/\/\S*\/invite\/[A-Za-z0-9_-]+/);
  const rawToken = link.split("/invite/")[1];
  assert.notEqual(stored.token, rawToken, "the invitation token is not stored in the clear");

  const page = await colleagueCtx.newPage();
  await page.goto(link, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  const join = page.locator("form:has(input[name=token]):has(input[name=password])");
  await join.locator("input[name=password]").waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(1000);
  await join.locator("input[name=name]").fill("E2E Colleague");
  await join.locator("input[name=password]").fill(E2E_PASSWORD);
  await join.locator("button[type=submit], button:not([type])").first().click();
  await page.waitForURL((u) => !u.pathname.includes("/invite/"), { timeout: NAV_TIMEOUT_MS });
  await settle(page);
  if (/\/signin/.test(page.url())) {
    await page.close();
    await (await signIn(colleagueCtx, { email: colleagueEmail, password: E2E_PASSWORD })).close();
  }
  const membership = await prisma.membership.findFirst({ where: { organizationId: admin.orgId, user: { email: colleagueEmail } } });
  assert.ok(membership, "the colleague is a member of the organisation");

  const cookie = await cookieHeader(colleagueCtx);
  const res = await get(`/en/requests/${requestId}`, { cookie });
  assert.equal(res.status, 200, "the colleague can open the organisation's request");
  assert.ok((await res.text()).includes(admin.orgName));
});

test("the invitation link cannot be used a second time", async (t) => {
  if (!APP_LOG) return t.skip("E2E_APP_LOG is not set");
  const link = await emailLink(colleagueEmail, /https?:\/\/\S*\/invite\/[A-Za-z0-9_-]+/);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(link, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  assert.equal(await page.locator("form:has(input[name=token]):has(input[name=password])").count(), 0, "a used invitation offers no join form");
  await ctx.close();
});

test("a removed member loses access to the organisation's data", async (t) => {
  if (!APP_LOG) return t.skip("E2E_APP_LOG is not set");
  const colleague = await prisma.user.findUnique({ where: { email: colleagueEmail }, select: { id: true } });
  assert.ok(colleague, "requires the invitation test");
  await goto(adminPage, "/en/account");
  const row = adminPage.locator(`form:has(input[name=userId][value="${colleague.id}"]):not(:has(select))`).first();
  await row.waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  await adminPage.waitForTimeout(1000);
  // Two-step: the first click only arms the button.
  await row.locator("button[type=button]").first().click();
  await adminPage.waitForTimeout(500);
  assert.ok(await prisma.membership.findFirst({ where: { organizationId: admin.orgId, userId: colleague.id, status: "ACTIVE" } }), "one click removes nobody");
  await row.locator("button[type=submit]").first().click();
  await settle(adminPage);
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    const m = await prisma.membership.findFirst({ where: { organizationId: admin.orgId, userId: colleague.id } });
    gone = !m || m.status !== "ACTIVE";
    if (!gone) await adminPage.waitForTimeout(250);
  }
  assert.ok(gone, "the membership is revoked");
  const cookie = await cookieHeader(colleagueCtx);
  const res = await get(`/en/requests/${requestId}`, { cookie, redirect: "follow" });
  assert.ok(!(await res.text()).includes(`E2E team ${RUN_TAG}`), "the removed member no longer sees the request");
  const direct = await get(`/en/requests/${requestId}`, { cookie });
  assert.ok([307, 308, 403, 404].includes(direct.status), `the removed member gets ${direct.status}`);
});
