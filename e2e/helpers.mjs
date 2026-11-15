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
