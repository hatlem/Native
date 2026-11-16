import { chromium } from "playwright-core";

export const BASE_URL = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
export const BUYER = {
  email: process.env.E2E_BUYER_EMAIL || process.env.BUYER_EMAIL || "buyer@nativespin.com",
  password: process.env.E2E_BUYER_PASSWORD || process.env.BUYER_PASSWORD || "nativespin-buyer",
};

// First navigation in dev mode compiles the route; be generous.
export const NAV_TIMEOUT_MS = 120_000;

export async function launchBrowser() {
  return chromium.launch({
    headless: true,
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  });
}

// Sign in through the real form. Resolves to the page, left on the post-login
// screen; throws if the app keeps us on /signin or sends us to email
// verification.
export async function signIn(context, { email, password }) {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/en/signin`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  // "load", not "networkidle": a dev server under fast refresh never goes idle.
  // The page holds several forms with an email field (password sign-in,
  // magic link, newsletter): scope to the one that has the password.
  const form = page.locator("form:has(input[name=password])").first();
  const emailInput = form.locator("input[name=email]");
  const passwordInput = form.locator("input[name=password]");
  // The form is a server action bound on hydration; a dev-mode fast refresh
  // can also remount it and clear the fields. Fill, confirm the values stuck,
  // submit — and retry once if the app bounced us back to the form.
  for (let attemptNo = 1; ; attemptNo++) {
    await emailInput.waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
    // Give React a beat to hydrate so the submit is the server action, not a
    // native GET of the form.
    await page.waitForTimeout(1500);
    await emailInput.fill(email);
    await passwordInput.fill(password);
    if ((await emailInput.inputValue()) !== email) continue;
    await form.locator('button[type=submit], button:not([type])').first().click();
    try {
      await page.waitForURL((u) => !u.pathname.includes("/signin"), { timeout: attemptNo < 3 ? 20_000 : NAV_TIMEOUT_MS });
      break;
    } catch (err) {
      if (attemptNo >= 3) throw err;
      await page.goto(`${BASE_URL}/en/signin`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    }
  }
  if (page.url().includes("/check-email")) {
    throw new Error(`${email} is not email-verified: the seed must create verified demo users`);
  }
  return page;
}

// The session cookie as a header value, for plain fetch() calls that must not
// follow redirects or run client JS.
export async function cookieHeader(context) {
  const cookies = await context.cookies(BASE_URL);
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

export async function get(path, { cookie, headers = {}, redirect = "manual" } = {}) {
  return fetch(`${BASE_URL}${path}`, {
    redirect,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers },
    signal: AbortSignal.timeout(NAV_TIMEOUT_MS),
  });
}

// ---------------------------------------------------------------------------
// Shared pieces for the journey suites (journey / self-service / team / mfa /
// a11y). Everything below drives the real UI; the database is touched only to
// create throwaway fixtures and to clean up.
// ---------------------------------------------------------------------------
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export const DESK = {
  email: process.env.E2E_DESK_EMAIL || process.env.DESK_ADMIN_EMAIL || "desk@nativespin.com",
  password: process.env.E2E_DESK_PASSWORD || process.env.DESK_ADMIN_PASSWORD || "nativespin-desk",
};
export const E2E_PASSWORD = "e2e-Password-123!";
// Every fixture this run creates carries the tag, so cleanup can find it.
export const RUN_TAG = `e2e${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;

export const goto = (page, path) =>
  page.goto(`${BASE_URL}${path}`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });

// Server-action forms answer with a redirect or an in-place refresh; give the
// transition time to land before reading the page.
export async function settle(page) {
  await page.waitForLoadState("load", { timeout: NAV_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

export async function mainText(page) {
  return page.locator("main").first().innerText();
}

// A fresh advertiser exactly as sign-up leaves it (org without a billing
// market, creator as its ADMIN), already email-verified. Used where the test
// is not about the sign-up form itself.
export async function createFreshBuyer(prisma, label, { onboarded = false } = {}) {
  const { default: bcrypt } = await import("bcryptjs");
  const email = `${RUN_TAG}-${label}@e2e.nativespin.test`;
  const org = await prisma.organization.create({
    data: { name: `E2E ${label} ${RUN_TAG}`, type: "ADVERTISER", marketCode: onboarded ? "NO" : null },
  });
  const user = await prisma.user.create({
    data: {
      email,
      name: `E2E ${label}`,
      role: "BUYER",
      passwordHash: await bcrypt.hash(E2E_PASSWORD, 4),
      organizationId: org.id,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.membership.create({
    data: { userId: user.id, organizationId: org.id, role: "ADMIN", canCommit: true },
  });
  return { email, password: E2E_PASSWORD, userId: user.id, orgId: org.id, orgName: org.name };
}

// Removal of everything a run created. The schema has many tables hanging
// off an organisation (plans, requests, quotes, orders, invoices, …), most
// with RESTRICT foreign keys, so rather than hard-code an order that rots with
// every migration this walks the foreign keys: children that would block a
// delete go first, recursively; CASCADE / SET NULL children are left to
// Postgres.
async function purge(prisma, table, ids, depth = 0) {
  if (ids.length === 0 || depth > 12) return;
  const children = await prisma.$queryRawUnsafe(
    `select c.conrelid::regclass::text as child, a.attname as col, c.confdeltype as rule,
            exists (select 1 from pg_attribute i where i.attrelid = c.conrelid and i.attname = 'id' and not i.attisdropped) as has_id
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = $1::regclass`,
    `"${table}"`,
  );
  for (const { child, col, rule, has_id } of children) {
    if (rule === "c" || rule === "n") continue;
    const childTable = child.replace(/"/g, "");
    if (has_id) {
      const rows = await prisma.$queryRawUnsafe(`select id from ${child} where "${col}" = any($1::text[])`, ids);
      if (childTable === table) {
        // Self-reference (e.g. a quote revision pointing at its predecessor).
        await prisma.$executeRawUnsafe(`update ${child} set "${col}" = null where "${col}" = any($1::text[])`, ids).catch(() => {});
      } else {
        await purge(prisma, childTable, rows.map((r) => r.id), depth + 1);
      }
    } else {
      await prisma.$executeRawUnsafe(`delete from ${child} where "${col}" = any($1::text[])`, ids).catch(() => {});
    }
  }
  await prisma.$executeRawUnsafe(`delete from "${table}" where id = any($1::text[])`, ids);
}

export async function cleanupRun(prisma) {
  const orgs = await prisma.organization.findMany({ where: { name: { contains: RUN_TAG } }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { email: { contains: RUN_TAG } }, select: { id: true } });
  try {
    await purge(prisma, "Organization", orgs.map((o) => o.id));
    await purge(prisma, "User", users.map((u) => u.id));
  } catch (err) {
    // Never fail a suite on cleanup: the database is disposable.
    console.warn(`e2e cleanup incomplete for ${RUN_TAG}: ${String(err.message).split("\n").pop()}`);
  }
}

// With RESEND_API_KEY unset and EMAIL_LOG_BODY=1 the app prints each email's
// plain-text body to its log ("[email-body] <to>"). E2E_APP_LOG is that log
// file; without it the mail-dependent tests skip.
export const APP_LOG = process.env.E2E_APP_LOG || "";

export async function emailLink(to, pattern, { timeoutMs = 20_000 } = {}) {
  if (!APP_LOG) throw new Error("E2E_APP_LOG is not set");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const log = readFileSync(APP_LOG, "utf8");
    const at = log.lastIndexOf(`[email-body] ${to}`);
    if (at >= 0) {
      const next = log.indexOf("[email-body] ", at + 1);
      const body = log.slice(at, next > 0 ? next : undefined);
      const hit = body.match(pattern);
      if (hit) return hit[0].replace(/[.,)>\]]+$/, "");
    }
    if (Date.now() > deadline) throw new Error(`no email to ${to} matching ${pattern} in ${APP_LOG}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

// RFC 6238 (SHA-1, 30 s, 6 digits) — what an authenticator app computes.
export function totp(secretBase32, atMs = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secretBase32.replace(/[\s=-]/g, "").toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error(`not base32: ${ch}`);
    bits += v.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

// ---- UI flows reused by several suites -------------------------------------

// A catalog title the seed makes orderable, with a placement on it.
export async function orderableTitleSlug(prisma) {
  const title = await prisma.title.findFirst({
    where: { active: true, products: { some: {} }, market: { code: "NO" } },
    orderBy: { slug: "asc" },
    select: { slug: true },
  });
  if (!title) throw new Error("the seed has no active title with products");
  return title.slug;
}

// Buyer: add the title's first placement to the plan and submit the request.
// Resolves to the new request id.
export async function submitRequestViaUi(page, slug, brief) {
  await goto(page, `/en/catalog/${slug}`);
  const add = page.locator("form:has(input[name=productId]) button").first();
  await add.waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  await add.click();
  await page.waitForURL((u) => /\/plan\//.test(u.pathname), { timeout: NAV_TIMEOUT_MS });
  await settle(page);
  const form = page.locator("form#plan-request-form");
  await form.locator("textarea").first().fill(brief);
  // The submit button sits outside the form element, tied to it by form="…".
  await page.locator('button[type=submit][form="plan-request-form"], form#plan-request-form button[type=submit]').first().click();
  await page.waitForURL((u) => /\/requests\/[a-z0-9]+$/.test(u.pathname), { timeout: NAV_TIMEOUT_MS });
  await settle(page);
  return page.url().match(/\/requests\/([a-z0-9]+)/)[1];
}

// Desk: draft a quote for the request, price every line and send it.
export async function sendQuoteViaUi(deskPage, requestId, prices = ["4690", "1000"]) {
  await goto(deskPage, `/en/desk/${requestId}`);
  await deskPage.getByRole("button", { name: /generate quote/i }).click();
  const priceForms = deskPage.locator("form:has(input[name=lineTotal])");
  await priceForms.first().waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  const lines = await priceForms.count();
  for (let i = 0; i < lines; i++) {
    const form = deskPage.locator("form:has(input[name=lineTotal])").nth(i);
    await form.locator("input[name=lineTotal]").fill(prices[i] ?? prices[prices.length - 1]);
    await form.locator("button[type=submit], button:not([type])").first().click();
    await settle(deskPage);
    await deskPage.waitForTimeout(500);
  }
  const send = deskPage.locator("form:has(input[name=validUntil])");
  await send.locator("button[type=submit], button:not([type])").first().click();
  await deskPage.locator("form:has(input[name=validUntil])").waitFor({ state: "detached", timeout: NAV_TIMEOUT_MS });
  await settle(deskPage);
}

// ---- Accessibility probe ---------------------------------------------------
// Runs inside the page. Only clear-cut, machine-decidable rules: a missing
// text alternative or accessible name, a missing lang, a skipped heading
// level, and text contrast below WCAG AA where the background is a solid
// colour we can resolve. Anything ambiguous (gradients, images behind text)
// is left out rather than guessed at.
export function a11yProbe() {
  const out = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.closest("[aria-hidden=true],[hidden],[inert]");
  };
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const labelledBy = (el) =>
    (el.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() || "")
      .join(" ")
      .trim();
  const name = (el) =>
    (el.getAttribute("aria-label") || "").trim() ||
    labelledBy(el) ||
    (el.labels && [...el.labels].map((l) => l.textContent.trim()).join(" ").trim()) ||
    (el.getAttribute("title") || "").trim();

  if (!document.documentElement.getAttribute("lang")) out.push({ rule: "html-lang", el: "html" });

  for (const img of document.querySelectorAll("img")) {
    if (!visible(img)) continue;
    if (!img.hasAttribute("alt") && img.getAttribute("role") !== "presentation") out.push({ rule: "img-alt", el: describe(img) });
  }
  for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")) {
    if (!visible(el)) continue;
    // A honeypot field is deliberately unlabelled and off-screen.
    if (el.tabIndex === -1 && el.getAttribute("autocomplete") === "off") continue;
    if (!name(el) && !(el.getAttribute("placeholder") || "").trim()) out.push({ rule: "field-name", el: describe(el) + `[name=${el.getAttribute("name") || ""}]` });
  }
  for (const el of document.querySelectorAll("button, a[href], [role=button]")) {
    if (!visible(el)) continue;
    const text = (el.textContent || "").trim() || name(el) || [...el.querySelectorAll("img[alt], svg[aria-label], svg title")].map((n) => n.getAttribute("alt") || n.getAttribute("aria-label") || n.textContent).join("").trim();
    if (!text) out.push({ rule: el.tagName === "A" ? "link-name" : "button-name", el: describe(el) });
  }
  let last = 0;
  for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    if (!visible(h)) continue;
    const level = Number(h.tagName[1]);
    if (last && level > last + 1) out.push({ rule: "heading-order", el: `${describe(h)} (h${last}→h${level}) "${h.textContent.trim().slice(0, 40)}"` });
    last = level;
  }

  // Contrast.
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  // Resolve the solid colour behind an element, or null when any ancestor
  // paints an image/gradient (not decidable from computed style).
  const background = (el) => {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== "none") return null;
      if (Number(s.opacity) < 1) return null;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a === 1) break;
      }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    const rootBg = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (rootBg && rootBg.a === 1) base = rootBg;
    for (const layer of layers.reverse()) base = over(layer, base);
    return base;
  };
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.trim()) continue;
    const el = node.parentElement;
    if (!el || !visible(el) || el.closest("button:disabled,[aria-disabled=true],.sr-only,.visually-hidden")) continue;
    const s = getComputedStyle(el);
    const fg0 = parse(s.color);
    const bg = background(el);
    if (!fg0 || !bg) continue;
    const fg = over(fg0, bg);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const px = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const large = px >= 24 || (bold && px >= 18.66);
    const need = large ? 3 : 4.5;
    // A small tolerance for sub-pixel colour blending.
    if (ratio < need - 0.05) {
      const key = `${s.color}|${JSON.stringify(bg)}|${large}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ rule: "contrast", el: `${describe(el)} "${node.nodeValue.trim().slice(0, 30)}" ${ratio.toFixed(2)}:1 (needs ${need}) ${s.color}` });
    }
  }
  return out;
}
