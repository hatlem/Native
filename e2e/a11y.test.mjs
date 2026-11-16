// Keyboard-only passes and an automated accessibility probe of the main
// pages. The probe (helpers.mjs a11yProbe) only reports machine-decidable
// failures: missing text alternatives / accessible names, a missing lang,
// skipped heading levels and text contrast below WCAG AA on solid
// backgrounds.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  BASE_URL,
  DESK,
  NAV_TIMEOUT_MS,
  a11yProbe,
  cleanupRun,
  createFreshBuyer,
  goto,
  launchBrowser,
  settle,
  signIn,
} from "./helpers.mjs";

let prisma;
let browser;
let buyer;

before(async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point at the app's (disposable) database");
  prisma = new PrismaClient();
  browser = await launchBrowser();
  buyer = await createFreshBuyer(prisma, "a11y", { onboarded: true });
});

after(async () => {
  await browser?.close();
  if (prisma) {
    await cleanupRun(prisma);
    await prisma.$disconnect();
  }
});

const active = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el ? { tag: el.tagName, name: el.getAttribute("name"), type: el.getAttribute("type"), role: el.getAttribute("role"), inDialog: !!el.closest("[role=dialog]") } : null;
  });

test("sign-in works with the keyboard alone", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await goto(page, "/en/signin");
  await page.locator("form:has(input[name=password]) input[name=email]").waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(1500);
  // The first focusable element is a skip link that jumps past the navigation.
  const first = await page.evaluate(() => {
    const el = [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")].find(
      (n) => n.tabIndex >= 0 && !n.hasAttribute("disabled") && n.getAttribute("type") !== "hidden",
    );
    if (!el) return null;
    el.focus();
    return { tag: el.tagName, href: el.getAttribute("href") };
  });
  assert.equal(first?.tag, "A");
  assert.match(first.href ?? "", /^#/, "the first Tab stop is the skip link");
  await page.waitForTimeout(500); // it slides in
  const shown = await page.evaluate(() => {
    const r = document.activeElement.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0;
  });
  assert.ok(shown, "the skip link is visible once focused");

  // Tab to the email field, type, Tab to the password, type, Enter.
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    const el = await active(page);
    reached = el?.tag === "INPUT" && el.name === "email" && (await page.evaluate(() => !!document.activeElement.closest("form")?.querySelector("input[name=password]")));
    if (!reached) await page.keyboard.press("Tab");
  }
  assert.ok(reached, "the email field is reachable by Tab");
  const outline = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { outline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0, shadow: s.boxShadow !== "none" };
  });
  assert.ok(outline.outline || outline.shadow, "the focused field has a visible focus indicator");
  await page.keyboard.type(buyer.email);
  await page.keyboard.press("Tab");
  // A "forgot password" link may sit between the fields.
  for (let i = 0; i < 4 && (await active(page))?.name !== "password"; i++) await page.keyboard.press("Tab");
  assert.equal((await active(page))?.name, "password");
  await page.keyboard.type(buyer.password);
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.includes("/signin"), { timeout: NAV_TIMEOUT_MS });
  await ctx.close();
});

test("the command palette traps focus and gives it back on Escape", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await signIn(ctx, buyer);
  await goto(page, "/en/requests");
  await settle(page);
  await page.waitForTimeout(1500);
  // Opened with the shortcut from wherever the user is: here, a nav link.
  const opener = page.locator("nav a[href]").first();
  await opener.focus();
  await page.keyboard.press("Control+k");
  const dialog = page.locator("[role=dialog][aria-modal=true]");
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  const start = await active(page);
  assert.ok(start?.inDialog, "focus moves into the palette");
  assert.equal(start.role, "combobox");
  // Tab and Shift+Tab never leave the dialog.
  for (const key of ["Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    assert.ok((await active(page))?.inDialog, `focus stayed in the palette after ${key}`);
  }
  // Arrow keys move the active option; the input announces it.
  await page.locator("[role=dialog] [role=combobox]").focus();
  await page.keyboard.press("ArrowDown");
  const descendant = await page.locator("[role=dialog] [role=combobox]").getAttribute("aria-activedescendant");
  assert.ok(descendant, "the combobox points at the active option");
  assert.equal(await page.locator(`[id="${descendant}"][role=option]`).count(), 1, "the active descendant is an option in the listbox");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  assert.ok(await opener.evaluate((el) => el === document.activeElement), "Escape returns focus to where the user was");

  // Where the header shows a search button, it opens the same palette.
  const button = page.locator("button.cmdk-trigger").first();
  if (await button.isVisible().catch(() => false)) {
    await button.focus();
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 10_000 });
    assert.ok(await button.evaluate((el) => el === document.activeElement), "focus returns to the search button");
  }
  await ctx.close();
});

// Pages every visitor or customer meets. Each is probed in light and dark.
const PUBLIC_PAGES = ["/en", "/en/signin", "/en/signup", "/en/pricing", "/en/catalog", "/en/help", "/en/security"];
const BUYER_PAGES = ["/en/home", "/en/catalog", "/en/plan", "/en/requests", "/en/invoices", "/en/account", "/en/account/security", "/en/notifications"];
const DESK_PAGES = ["/en/desk", "/en/desk/requests", "/en/desk/orders", "/en/desk/reports"];

async function probe(ctx, paths) {
  const failures = [];
  const page = await ctx.newPage();
  for (const path of paths) {
    const res = await goto(page, path);
    assert.ok(res.status() < 400, `${path} → ${res.status()}`);
    await settle(page);
    for (const v of await page.evaluate(a11yProbe)) failures.push(`${path}  ${v.rule}  ${v.el}`);
  }
  await page.close();
  return failures;
}

for (const scheme of ["light", "dark"]) {
  test(`accessibility probe: public pages (${scheme})`, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    const failures = await probe(ctx, PUBLIC_PAGES);
    await ctx.close();
    assert.deepEqual(failures, [], `${failures.length} violation(s):\n${failures.join("\n")}`);
  });

  test(`accessibility probe: buyer pages (${scheme})`, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    await (await signIn(ctx, buyer)).close();
    const failures = await probe(ctx, BUYER_PAGES);
    await ctx.close();
    assert.deepEqual(failures, [], `${failures.length} violation(s):\n${failures.join("\n")}`);
  });

  test(`accessibility probe: desk pages (${scheme})`, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    await (await signIn(ctx, DESK)).close();
    const failures = await probe(ctx, DESK_PAGES);
    await ctx.close();
    assert.deepEqual(failures, [], `${failures.length} violation(s):\n${failures.join("\n")}`);
  });
}

test("pages carry the language of their locale", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const locale of ["en", "no", "sv", "da", "de", "fi"]) {
    await page.goto(`${BASE_URL}/${locale}`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    const lang = await page.evaluate(() => document.documentElement.lang);
    assert.ok(lang.toLowerCase().startsWith(locale === "no" ? "n" : locale), `/${locale} has lang="${lang}"`);
  }
  await ctx.close();
});
