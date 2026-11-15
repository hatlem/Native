// Two-factor: enrol with an authenticator code, then sign in with password +
// code. No session may exist before the second factor.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  BASE_URL,
  NAV_TIMEOUT_MS,
  cleanupRun,
  cookieHeader,
  createFreshBuyer,
  get,
  goto,
  launchBrowser,
  settle,
  signIn,
  totp,
} from "./helpers.mjs";

let prisma;
let browser;
let user;
let secret = "";
let usedCode = "";

before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point at the app's (disposable) database");
  prisma = new PrismaClient();
  browser = await launchBrowser();
  user = await createFreshBuyer(prisma, "mfa", { onboarded: true });
});

after(async () => {
  await browser?.close();
  if (prisma) {
    await cleanupRun(prisma);
    await prisma.$disconnect();
  }
});

// A code is valid for 30 s; start a fresh step if the current one is about to end.
async function freshCode(page) {
  if (30_000 - (Date.now() % 30_000) < 5_000) await page.waitForTimeout(6_000);
  return totp(secret);
}

async function passwordStep(ctx) {
  const page = await ctx.newPage();
  await goto(page, "/en/signin");
  const form = page.locator("form:has(input[name=password])").first();
  await form.locator("input[name=email]").waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(1500);
  await form.locator("input[name=email]").fill(user.email);
  await form.locator("input[name=password]").fill(user.password);
  await form.locator("button[type=submit], button:not([type])").first().click();
  await page.waitForURL((u) => u.pathname.includes("/signin/mfa"), { timeout: NAV_TIMEOUT_MS });
  return page;
}

test("a user enrols an authenticator app and gets recovery codes", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await signIn(ctx, user);
  await goto(page, "/en/account/security");
  await page.waitForTimeout(1000);
  await page.locator("main form button").first().click();
  const key = page.locator("#mfa-setup-key");
  await key.waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  secret = (await key.inputValue()).replace(/\s+/g, "");
  assert.match(secret, /^[A-Z2-7]{16,}$/, "the setup key is base32");
  const stored = await prisma.user.findUnique({ where: { id: user.userId } });
  assert.ok(!JSON.stringify(stored).includes(secret), "the secret is not stored in the clear");

  // A wrong code enables nothing.
  const enrol = page.locator("form:has(#mfa-enrol-code)");
  await enrol.locator("#mfa-enrol-code").fill("000000");
  await enrol.locator("button[type=submit], button:not([type])").first().click();
  await settle(page);
  await page.waitForTimeout(1000);
  assert.ok(!(await prisma.user.findUnique({ where: { id: user.userId } })).mfaEnabledAt, "a wrong code does not enable two-factor");

  usedCode = await freshCode(page);
  const enrol2 = page.locator("form:has(#mfa-enrol-code)");
  await enrol2.locator("#mfa-enrol-code").fill(usedCode);
  await enrol2.locator("button[type=submit], button:not([type])").first().click();
  let enabled = false;
  for (let i = 0; i < 60 && !enabled; i++) {
    enabled = !!(await prisma.user.findUnique({ where: { id: user.userId } })).mfaEnabledAt;
    if (!enabled) await page.waitForTimeout(250);
  }
  assert.ok(enabled, "two-factor is on after a correct code");
  await settle(page);
  const body = await page.locator("main").innerText();
  const codes = body.match(/\b[A-Za-z0-9]{4,6}-[A-Za-z0-9]{4,6}\b/g) ?? [];
  assert.ok(codes.length >= 8, `recovery codes are shown once (${codes.length} found)`);
  await ctx.close();
});

test("sign-in asks for the code and issues no session before it", async () => {
  assert.ok(secret, "requires the enrolment test");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await passwordStep(ctx);
  assert.doesNotMatch(await cookieHeader(ctx), /authjs\.session-token=/, "the password alone issues no session");
  const blocked = await get("/en/requests", { cookie: await cookieHeader(ctx) });
  assert.equal(blocked.status, 307, "protected pages stay closed at the code prompt");

  // A wrong code is refused.
  const form = page.locator("form:has(input[name=code])").first();
  await page.waitForTimeout(1000);
  await form.locator("input[name=code]").fill("123456");
  await form.locator("button[type=submit], button:not([type])").first().click();
  await settle(page);
  await page.waitForTimeout(1000);
  assert.doesNotMatch(await cookieHeader(ctx), /authjs\.session-token=/, "a wrong code issues no session");

  // A fresh, unused time step (the enrolment step cannot be replayed).
  let code = await freshCode(page);
  while (code === usedCode) {
    await page.waitForTimeout(5_000);
    code = await freshCode(page);
  }
  const form2 = page.locator("form:has(input[name=code])").first();
  await form2.locator("input[name=code]").fill(code);
  await form2.locator("button[type=submit], button:not([type])").first().click();
  await page.waitForURL((u) => !u.pathname.includes("/signin"), { timeout: NAV_TIMEOUT_MS });
  assert.match(await cookieHeader(ctx), /authjs\.session-token=/, "password + code issues the session");
  usedCode = code;
  const res = await page.goto(`${BASE_URL}/en/requests`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  assert.equal(res.status(), 200);
  await ctx.close();
});

test("a code cannot be replayed within its time step", async () => {
  assert.ok(usedCode, "requires the sign-in test");
  if (totp(secret) !== usedCode) return; // the step has rolled over: nothing to replay
  const ctx = await browser.newContext();
  const page = await passwordStep(ctx);
  await page.waitForTimeout(1000);
  const form = page.locator("form:has(input[name=code])").first();
  await form.locator("input[name=code]").fill(usedCode);
  await form.locator("button[type=submit], button:not([type])").first().click();
  await settle(page);
  await page.waitForTimeout(1500);
  assert.doesNotMatch(await cookieHeader(ctx), /authjs\.session-token=/, "the same code is refused a second time");
  await ctx.close();
});
