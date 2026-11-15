// Smoke suite: the handful of things that must never break silently.
// See e2e/README.md for how to run it.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { BASE_URL, BUYER, NAV_TIMEOUT_MS, cookieHeader, get, launchBrowser, signIn } from "./helpers.mjs";

// A marker that can only come from the foreign organisation's data.
const MARKER = `E2E-FOREIGN-ORG-${Date.now()}`;

let browser;
let context;
let cookie = "";
let prisma;
const foreign = { orgId: "", planId: "", requestId: "" };

before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point at the app's (disposable) database");
  prisma = new PrismaClient();
  // Another customer's data: an organisation the buyer is NOT a member of,
  // with a submitted request the desk can see.
  const org = await prisma.organization.create({ data: { name: MARKER, type: "ADVERTISER" } });
  const plan = await prisma.plan.create({ data: { organizationId: org.id, name: `${MARKER} plan` } });
  const request = await prisma.request.create({
    data: { organizationId: org.id, planId: plan.id, status: "SUBMITTED", briefSummary: `${MARKER} brief` },
  });
  Object.assign(foreign, { orgId: org.id, planId: plan.id, requestId: request.id });

  browser = await launchBrowser();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
});

after(async () => {
  await browser?.close();
  if (prisma) {
    await prisma.request.deleteMany({ where: { organizationId: foreign.orgId } }).catch(() => {});
    await prisma.plan.deleteMany({ where: { organizationId: foreign.orgId } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: foreign.orgId } }).catch(() => {});
    await prisma.$disconnect();
  }
});

test("health endpoint reports the database as reachable", async () => {
  const res = await get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok", db: "ok" });
});

test("public catalog page renders without a session", async () => {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto(`${BASE_URL}/en/catalog`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  assert.equal(res.status(), 200);
  assert.ok((await page.locator("h1").first().innerText()).length > 0, "catalog has a heading");
  // Signed out, the catalog is a teaser with the live title count.
  assert.match(await page.locator("body").innerText(), /\d[\d,. ]* titles/i, "catalog shows its title count");
  assert.deepEqual(errors, [], "no uncaught client errors");
  await page.close();
});

test("a signed-out visit to a protected page redirects to sign-in", async () => {
  for (const path of ["/en/requests", "/en/invoices", "/en/desk", "/en/account"]) {
    const res = await get(path);
    assert.equal(res.status, 307, path);
    assert.match(res.headers.get("location") ?? "", /\/en\/signin/, path);
  }
});

test("the seeded buyer can sign in and reach the buyer area", async () => {
  const page = await signIn(context, BUYER);
  cookie = await cookieHeader(context);
  assert.match(cookie, /authjs\.session-token=/, "a session cookie was issued");
  const res = await page.goto(`${BASE_URL}/en/requests`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  assert.equal(res.status(), 200);
  assert.ok(!page.url().includes("/signin"));
  await page.close();
});

test("tenant isolation: another organisation's request is a 404 for the buyer", async () => {
  assert.ok(cookie, "requires the sign-in test");
  const pageRes = await get(`/en/requests/${foreign.requestId}`, { cookie });
  assert.equal(pageRes.status, 404);
  assert.ok(!(await pageRes.text()).includes(MARKER), "the 404 page leaks nothing");

  // The same id through the React Server Components transport.
  const rsc = await get(`/en/requests/${foreign.requestId}`, { cookie, headers: { RSC: "1" }, redirect: "follow" });
  assert.ok(!(await rsc.text()).includes(MARKER), "the RSC payload leaks nothing");
});

test("role isolation: a buyer's RSC request to desk pages returns no desk data", async () => {
  assert.ok(cookie, "requires the sign-in test");
  // Regression: the desk layout redirected, but the page segment still
  // rendered into the RSC payload with every organisation's requests.
  for (const path of ["/en/desk", `/en/desk/${foreign.requestId}`, "/en/desk/orders", "/en/desk/reports"]) {
    for (const headers of [{}, { RSC: "1" }, { RSC: "1", "Next-Router-Prefetch": "1" }]) {
      const res = await get(path, { cookie, headers, redirect: "follow" });
      const body = await res.text();
      assert.ok(!body.includes(MARKER), `${path} ${JSON.stringify(headers)} leaked another organisation's data`);
    }
  }
});

test("exports are organisation-scoped", async () => {
  assert.ok(cookie, "requires the sign-in test");
  const accounting = await get("/api/export/invoices/accounting.json", { cookie });
  assert.equal(accounting.status, 403, "bulk accounting export is desk-only");
  const mine = await get("/api/export/me", { cookie });
  assert.equal(mine.status, 200);
  assert.ok(!(await mine.text()).includes(MARKER), "the self-service export holds only the caller's data");
});
