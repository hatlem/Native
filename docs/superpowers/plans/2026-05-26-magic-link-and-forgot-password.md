# Magic Link + Forgot Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add passwordless magic-link sign-in alongside existing password auth, a full forgot-password flow, and wire Resend so all five auth emails (magic link, password reset, welcome, password-changed, new-sign-in alert) actually deliver.

**Architecture:** Two new Prisma models (`MagicLinkToken`, `PasswordResetToken`) mirror the existing `PublisherInvite` pattern but store SHA-256 hashes of tokens. A second NextAuth Credentials provider (id `"magic-link"`) owns atomic consume-and-sign-in. Resend adapter slots into the existing `EmailAdapter` interface. Three new server-component pages handle the user-facing surface. JWT sessions stay untouched.

**Tech Stack:** Next.js 15 App Router, NextAuth v5 beta, Prisma 6, PostgreSQL, next-intl, Resend, `tsx --test` (node test runner) + `node:assert/strict`. No Vitest, no Jest, no spy library — tests are for pure functions.

**Locales:** en, no, sv, da, de, fi (six). All UI and email copy localized.

**Spec:** `docs/superpowers/specs/2026-05-26-magic-link-and-forgot-password-design.md`

---

## File map

**New files:**

- `prisma/migrations/<timestamp>_auth_tokens/migration.sql` — token tables + User columns
- `src/lib/tokens.ts` — token generate/hash/expiry helpers
- `src/lib/tokens.test.ts`
- `src/lib/auth-events.ts` — `recordSignIn(userId, ip)` shared helper
- `src/lib/auth-events.test.ts`
- `src/lib/mail/index.ts` — boots the Resend adapter at import time
- `src/lib/mail/resend.ts` — `makeResendAdapter()` factory
- `src/lib/mail/resend.test.ts`
- `src/lib/mail/templates/layout.ts` — shared HTML shell
- `src/lib/mail/templates/strings.ts` — locale-keyed copy for all five emails
- `src/lib/mail/templates/magic-link.ts`
- `src/lib/mail/templates/magic-link.test.ts`
- `src/lib/mail/templates/password-reset.ts`
- `src/lib/mail/templates/password-reset.test.ts`
- `src/lib/mail/templates/welcome.ts`
- `src/lib/mail/templates/welcome.test.ts`
- `src/lib/mail/templates/password-changed.ts`
- `src/lib/mail/templates/password-changed.test.ts`
- `src/lib/mail/templates/new-signin-alert.ts`
- `src/lib/mail/templates/new-signin-alert.test.ts`
- `src/app/[locale]/(marketing)/check-email/page.tsx`
- `src/app/[locale]/(marketing)/forgot-password/page.tsx`
- `src/app/[locale]/(marketing)/reset-password/[token]/page.tsx`
- `src/app/[locale]/magic-link/[token]/page.tsx`
- `scripts/cleanup-auth-tokens.ts`
- `docs/testing/auth-flows.md` — manual E2E checklist

**Modified files:**

- `prisma/schema.prisma` — add `MagicLinkToken`, `PasswordResetToken`, fields on `User`
- `src/lib/notify.ts` — extend `EmailMessage` type with optional `html?: string`
- `src/auth.ts` — add second Credentials provider with id `"magic-link"`, import `@/lib/mail` for adapter boot
- `src/app/auth-actions.ts` — three new exports (`requestMagicLink`, `requestPasswordReset`, `resetPassword`); modify `register` to send welcome; modify `authenticate` to call `recordSignIn`
- `src/app/[locale]/(marketing)/signin/page.tsx` — add magic-link form + forgot-password link
- `src/messages/en.json` (and `no`, `sv`, `da`, `de`, `fi`) — extend `auth` namespace
- `.env.example` — add `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_REPLY_TO`
- `package.json` — add `resend` dependency

---

## Test strategy

Match the existing codebase pattern:

- **Pure functions** (`tokens.ts`, template builders, `recordSignIn`'s decision logic) get `node:test` unit tests.
- **Server actions** that hit the DB are NOT unit-tested in this iteration — the codebase pattern is manual E2E for those, and we follow it. The manual checklist in `docs/testing/auth-flows.md` covers them.
- **Pages** are not tested — visual + manual.

This deviates from the spec's "integration tests" section, in favor of the codebase's actual conventions. The spec mentions DB-backed tests for completeness; we don't add a new test layer just for this feature.

---

## Pre-flight

- [ ] **Confirm test command works**

Run: `pnpm test`
Expected: existing tests pass, no errors

- [ ] **Confirm typecheck baseline**

Run: `pnpm typecheck`
Expected: zero errors

- [ ] **Confirm Prisma client is generated**

Run: `pnpm prisma generate`
Expected: "Generated Prisma Client" message, no errors

---

## Task 1: Add token models and User fields to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_auth_tokens/migration.sql` (generated)

- [ ] **Step 1: Add new fields to the `User` model**

Edit `prisma/schema.prisma`. Inside `model User { ... }`, after `updatedAt`, add:

```prisma
  emailVerifiedAt DateTime?
  lastSignInIp    String?
  lastSignInAt    DateTime?

  magicLinkTokens     MagicLinkToken[]
  passwordResetTokens PasswordResetToken[]
```

- [ ] **Step 2: Add the two new models at the end of the file**

Append to `prisma/schema.prisma`:

```prisma
// Single-use magic-link sign-in token. Hashed at rest (SHA-256); the raw
// token only ever lives in the email URL. Mirrors the PublisherInvite
// pattern (single-use, time-limited).
model MagicLinkToken {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash   String    @unique
  expiresAt   DateTime
  consumedAt  DateTime?
  requestedIp String?
  createdAt   DateTime  @default(now())

  @@index([userId])
  @@index([expiresAt])
}

// Single-use password-reset token. Same shape as MagicLinkToken — the two
// are kept as separate tables so we can prune / rate-limit / audit them
// independently and so a request for one doesn't shorten the window of
// the other.
model PasswordResetToken {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash   String    @unique
  expiresAt   DateTime
  consumedAt  DateTime?
  requestedIp String?
  createdAt   DateTime  @default(now())

  @@index([userId])
  @@index([expiresAt])
}
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm prisma migrate dev --name auth_tokens`
Expected: "Your database is now in sync with your schema" + a new migration directory under `prisma/migrations/`.

- [ ] **Step 4: Verify the Prisma client picks up the new models**

Run: `pnpm prisma generate`
Then run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(auth): add MagicLinkToken and PasswordResetToken models"
```

---

## Task 2: Token helpers (`src/lib/tokens.ts`)

**Files:**
- Create: `src/lib/tokens.ts`
- Test: `src/lib/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tokens.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateToken, hashToken, tokenExpiry, AUTH_TOKEN_TTL_MIN } from "./tokens";

test("generateToken yields 43-char url-safe base64 (32 bytes → 43 chars without padding)", () => {
  const t = generateToken();
  assert.equal(t.length, 43);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
});

test("generateToken collisions are statistically implausible", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i += 1) {
    const t = generateToken();
    assert.equal(seen.has(t), false);
    seen.add(t);
  }
});

test("hashToken is deterministic and yields 64-char hex", () => {
  const raw = "abc123";
  const h1 = hashToken(raw);
  const h2 = hashToken(raw);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.match(h1, /^[0-9a-f]+$/);
});

test("hashToken distinguishes different inputs", () => {
  assert.notEqual(hashToken("a"), hashToken("b"));
});

test("tokenExpiry returns a date AUTH_TOKEN_TTL_MIN minutes in the future", () => {
  const before = Date.now();
  const exp = tokenExpiry().getTime();
  const after = Date.now();
  const expectedMs = AUTH_TOKEN_TTL_MIN * 60_000;
  assert.ok(exp - before >= expectedMs - 1000);
  assert.ok(exp - after <= expectedMs + 1000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/tokens.test.ts`
Expected: FAIL with "Cannot find module './tokens'" or similar.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/tokens.ts`:

```ts
import crypto from "node:crypto";

// 15-min TTL applies to both magic-link and password-reset tokens.
// One constant, one place — configurable TTLs invite drift.
export const AUTH_TOKEN_TTL_MIN = 15;

// 32 bytes → 256 bits of entropy → 43 base64url chars.
const TOKEN_BYTES = 32;

export function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function tokenExpiry(): Date {
  return new Date(Date.now() + AUTH_TOKEN_TTL_MIN * 60_000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/tokens.test.ts`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tokens.ts src/lib/tokens.test.ts
git commit -m "feat(auth): token generate/hash/expiry helpers"
```

---

## Task 3: Extend `EmailMessage` with optional `html`

**Files:**
- Modify: `src/lib/notify.ts`

- [ ] **Step 1: Add `html?` to the `EmailMessage` type**

Edit `src/lib/notify.ts`. Change:

```ts
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};
```

to:

```ts
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};
```

- [ ] **Step 2: Verify the consoleAdapter still works with the new shape**

The existing `consoleAdapter` only uses `to` and `subject`, so it needs no change. Confirm by reading lines 23-25 of `src/lib/notify.ts`:

```ts
const consoleAdapter: EmailAdapter = async (msg) => {
  console.log("[email]", msg.to, "·", msg.subject);
};
```

No edits needed.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors (the change is purely additive).

- [ ] **Step 4: Commit**

```bash
git add src/lib/notify.ts
git commit -m "refactor(notify): allow optional html on EmailMessage"
```

---

## Task 4: Install Resend SDK

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install**

Run: `pnpm add resend`
Expected: `package.json` now lists `resend` under dependencies; lockfile updated.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add resend dependency"
```

---

## Task 5: Resend adapter (`src/lib/mail/resend.ts`)

**Files:**
- Create: `src/lib/mail/resend.ts`
- Test: `src/lib/mail/resend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/mail/resend.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeResendAdapter } from "./resend";

test("makeResendAdapter returns null when RESEND_API_KEY is absent", () => {
  const adapter = makeResendAdapter({ RESEND_API_KEY: "" } as NodeJS.ProcessEnv);
  assert.equal(adapter, null);
});

test("makeResendAdapter returns a function when RESEND_API_KEY is set", () => {
  const adapter = makeResendAdapter({
    RESEND_API_KEY: "re_test_key",
  } as NodeJS.ProcessEnv);
  assert.equal(typeof adapter, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/mail/resend.test.ts`
Expected: FAIL with "Cannot find module './resend'".

- [ ] **Step 3: Write the adapter**

Create `src/lib/mail/resend.ts`:

```ts
import { Resend } from "resend";
import type { EmailAdapter } from "@/lib/notify";

// Factory returns null when no API key is set — the boot path (mail/index.ts)
// then leaves the existing console adapter in place. That way `pnpm dev`
// works offline and CI works without secrets, while every "real" send is
// visible in the [email] log line.
export function makeResendAdapter(
  env: NodeJS.ProcessEnv = process.env,
): EmailAdapter | null {
  const key = env.RESEND_API_KEY;
  if (!key) return null;
  const client = new Resend(key);
  const from = env.AUTH_EMAIL_FROM ?? "NativeSpin <noreply@nativespin.com>";
  const replyTo = env.AUTH_EMAIL_REPLY_TO;
  return async (msg) => {
    await client.emails.send({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      replyTo,
    });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/mail/resend.test.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/resend.ts src/lib/mail/resend.test.ts
git commit -m "feat(mail): resend adapter factory"
```

---

## Task 6: Boot wiring (`src/lib/mail/index.ts`)

**Files:**
- Create: `src/lib/mail/index.ts`
- Modify: `src/auth.ts`

- [ ] **Step 1: Create the boot file**

Create `src/lib/mail/index.ts`:

```ts
// Side-effect import: installs the Resend adapter if RESEND_API_KEY is set,
// otherwise leaves the existing console adapter from notify.ts in place.
// Imported once from src/auth.ts so it runs at server boot.

import { setEmailAdapter } from "@/lib/notify";
import { makeResendAdapter } from "./resend";

const adapter = makeResendAdapter();
if (adapter) setEmailAdapter(adapter);
```

- [ ] **Step 2: Import it from `src/auth.ts`**

Edit `src/auth.ts`. Near the top, after the existing imports, add:

```ts
import "@/lib/mail";
```

It must be a side-effect import (no `from`) and run before any `signIn` call.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Smoke test the boot path**

Start the dev server briefly:

Run: `pnpm dev`
Then in another shell: `curl -s http://localhost:<your-configured-port>/ -o /dev/null -w "%{http_code}\n"`
Expected: a `200` or `307` HTTP code (locale redirect). The dev server output should not throw an error about Resend missing.

Kill the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/index.ts src/auth.ts
git commit -m "feat(mail): wire resend adapter at server boot"
```

---

## Task 7: Email layout + locale strings

**Files:**
- Create: `src/lib/mail/templates/layout.ts`
- Create: `src/lib/mail/templates/strings.ts`

- [ ] **Step 1: Create the layout helper**

Create `src/lib/mail/templates/layout.ts`:

```ts
// One HTML shell for every auth email. Inline styles only (Outlook).
// No external assets. The CTA button degrades to a styled link.

export type LayoutArgs = {
  preheader: string;
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footer: string;
  appName: string;
};

const COLOR_BG = "#f5f6f8";
const COLOR_CARD = "#ffffff";
const COLOR_TEXT = "#1a1a1a";
const COLOR_MUTED = "#6b7280";
const COLOR_ACCENT = "#0b6cff";

export function layout(args: LayoutArgs): string {
  const cta = args.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
        <tr><td>
          <a href="${escapeHtml(args.cta.url)}"
             style="background:${COLOR_ACCENT};color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600;">
            ${escapeHtml(args.cta.label)}
          </a>
        </td></tr>
       </table>`
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(args.heading)}</title></head>
<body style="margin:0;padding:24px;background:${COLOR_BG};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${COLOR_TEXT};">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${escapeHtml(args.preheader)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr><td style="padding:16px 0;color:${COLOR_MUTED};font-size:14px;">${escapeHtml(args.appName)}</td></tr>
    <tr><td style="background:${COLOR_CARD};border-radius:10px;padding:32px;">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">${escapeHtml(args.heading)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.55;color:${COLOR_TEXT};">${escapeHtml(args.body)}</p>
      ${cta}
      <p style="margin:24px 0 0;font-size:13px;color:${COLOR_MUTED};line-height:1.5;">${escapeHtml(args.footer)}</p>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 2: Create the locale strings**

Create `src/lib/mail/templates/strings.ts`:

```ts
// Locale-keyed copy for the five auth emails. Co-located with the
// templates because they're tied to the email layout, not the UI
// translation surface. If you add a sixth email, add its strings here.

export type Locale = "en" | "no" | "sv" | "da" | "de" | "fi";

type EmailStrings = {
  magicLink: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: string;
    cta: string;
    footer: string;
  };
  passwordReset: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: string;
    cta: string;
    footer: string;
  };
  welcome: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: (app: string) => string;
    cta: string;
    footer: string;
  };
  passwordChanged: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: (ip: string, at: string) => string;
    footer: string;
  };
  newSigninAlert: {
    subject: (app: string) => string;
    preheader: string;
    heading: string;
    body: (ip: string, at: string) => string;
    cta: string;
    footer: string;
  };
};

const en: EmailStrings = {
  magicLink: {
    subject: (app) => `Sign in to ${app}`,
    preheader: "Your sign-in link is ready.",
    heading: "Sign in",
    body: "Click the button below to sign in. This link is valid for 15 minutes and can only be used once.",
    cta: "Sign in",
    footer: "If you didn't request this, you can safely ignore this email.",
  },
  passwordReset: {
    subject: (app) => `Reset your ${app} password`,
    preheader: "Reset your password.",
    heading: "Reset your password",
    body: "Click the button below to set a new password. This link is valid for 15 minutes and can only be used once.",
    cta: "Reset password",
    footer: "If you didn't request this, you can safely ignore this email — your password won't change.",
  },
  welcome: {
    subject: (app) => `Welcome to ${app}`,
    preheader: "Your account is ready.",
    heading: "Welcome",
    body: (app) => `Your ${app} account is ready. Browse the catalog whenever you want, and submit a brief whenever you're ready to buy.`,
    cta: "Browse the catalog",
    footer: "Need help? Just reply to this email.",
  },
  passwordChanged: {
    subject: (app) => `Your ${app} password was changed`,
    preheader: "Password updated.",
    heading: "Password changed",
    body: (ip, at) => `Your password was changed on ${at} (IP ${ip}). If this wasn't you, reply to this email immediately.`,
    footer: "For your security, we email every password change.",
  },
  newSigninAlert: {
    subject: (app) => `New sign-in to your ${app} account`,
    preheader: "A new device signed in.",
    heading: "New sign-in detected",
    body: (ip, at) => `A new sign-in to your account was detected on ${at} (IP ${ip}). If this was you, no action is needed.`,
    cta: "Reset password",
    footer: "If you don't recognise this, reset your password using the button above.",
  },
};

// Stub all other locales as English for now. Translate before launch —
// task notes call out where. Keys must match `en` exactly.
const no: EmailStrings = en;
const sv: EmailStrings = en;
const da: EmailStrings = en;
const de: EmailStrings = en;
const fi: EmailStrings = en;

const TABLE: Record<Locale, EmailStrings> = { en, no, sv, da, de, fi };

export function strings(locale: string): EmailStrings {
  return TABLE[(locale as Locale)] ?? en;
}
```

> **Note for translator:** the `no`, `sv`, `da`, `de`, `fi` exports are currently aliased to `en`. Before shipping to production, translate each one. The keys must stay identical to `en` so TypeScript catches missing entries.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/mail/templates/layout.ts src/lib/mail/templates/strings.ts
git commit -m "feat(mail): email layout + locale strings for auth emails"
```

---

## Task 8: Magic-link email template

**Files:**
- Create: `src/lib/mail/templates/magic-link.ts`
- Test: `src/lib/mail/templates/magic-link.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/mail/templates/magic-link.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { magicLinkEmail } from "./magic-link";

const URL = "https://nativespin.com/en/magic-link/abc123";

test("magicLinkEmail returns subject, text, html with the URL embedded", () => {
  const m = magicLinkEmail({ url: URL, locale: "en", appName: "NativeSpin" });
  assert.ok(m.subject.includes("NativeSpin"));
  assert.ok(m.text.includes(URL));
  assert.ok(m.html!.includes(URL));
});

test("magicLinkEmail falls back to en for unknown locale", () => {
  const m = magicLinkEmail({ url: URL, locale: "klingon", appName: "NativeSpin" });
  assert.ok(m.subject.includes("NativeSpin"));
  assert.ok(m.text.includes(URL));
});

test("magicLinkEmail text body is plain (no HTML tags)", () => {
  const m = magicLinkEmail({ url: URL, locale: "en", appName: "NativeSpin" });
  assert.equal(m.text.includes("<"), false);
  assert.equal(m.text.includes(">"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/mail/templates/magic-link.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the template**

Create `src/lib/mail/templates/magic-link.ts`:

```ts
import { layout } from "./layout";
import { strings } from "./strings";

export type MagicLinkArgs = {
  url: string;
  locale: string;
  appName: string;
};

export function magicLinkEmail(args: MagicLinkArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).magicLink;
  return {
    subject: t.subject(args.appName),
    text: `${t.body}\n\n${args.url}\n\n${t.footer}`,
    html: layout({
      preheader: t.preheader,
      heading: t.heading,
      body: t.body,
      cta: { label: t.cta, url: args.url },
      footer: t.footer,
      appName: args.appName,
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/mail/templates/magic-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/templates/magic-link.ts src/lib/mail/templates/magic-link.test.ts
git commit -m "feat(mail): magic-link email template"
```

---

## Task 9: Password-reset email template

**Files:**
- Create: `src/lib/mail/templates/password-reset.ts`
- Test: `src/lib/mail/templates/password-reset.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/mail/templates/password-reset.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordResetEmail } from "./password-reset";

const URL = "https://nativespin.com/en/reset-password/abc123";

test("passwordResetEmail returns subject, text, html with the URL embedded", () => {
  const m = passwordResetEmail({ url: URL, locale: "en", appName: "NativeSpin" });
  assert.ok(m.subject.toLowerCase().includes("password"));
  assert.ok(m.text.includes(URL));
  assert.ok(m.html!.includes(URL));
});

test("passwordResetEmail footer says password won't change unprompted", () => {
  const m = passwordResetEmail({ url: URL, locale: "en", appName: "NativeSpin" });
  assert.match(m.text, /password won't change|password will not change/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/mail/templates/password-reset.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the template**

Create `src/lib/mail/templates/password-reset.ts`:

```ts
import { layout } from "./layout";
import { strings } from "./strings";

export type PasswordResetArgs = {
  url: string;
  locale: string;
  appName: string;
};

export function passwordResetEmail(args: PasswordResetArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).passwordReset;
  return {
    subject: t.subject(args.appName),
    text: `${t.body}\n\n${args.url}\n\n${t.footer}`,
    html: layout({
      preheader: t.preheader,
      heading: t.heading,
      body: t.body,
      cta: { label: t.cta, url: args.url },
      footer: t.footer,
      appName: args.appName,
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/mail/templates/password-reset.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/templates/password-reset.ts src/lib/mail/templates/password-reset.test.ts
git commit -m "feat(mail): password-reset email template"
```

---

## Task 10: Welcome email template

**Files:**
- Create: `src/lib/mail/templates/welcome.ts`
- Test: `src/lib/mail/templates/welcome.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/mail/templates/welcome.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { welcomeEmail } from "./welcome";

test("welcomeEmail subject includes the app name", () => {
  const m = welcomeEmail({ catalogUrl: "https://nativespin.com/en/catalog", locale: "en", appName: "NativeSpin" });
  assert.ok(m.subject.includes("NativeSpin"));
});

test("welcomeEmail body references the app name", () => {
  const m = welcomeEmail({ catalogUrl: "https://nativespin.com/en/catalog", locale: "en", appName: "NativeSpin" });
  assert.ok(m.text.includes("NativeSpin"));
});

test("welcomeEmail CTA points to the catalog url", () => {
  const url = "https://nativespin.com/en/catalog";
  const m = welcomeEmail({ catalogUrl: url, locale: "en", appName: "NativeSpin" });
  assert.ok(m.html!.includes(url));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/mail/templates/welcome.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the template**

Create `src/lib/mail/templates/welcome.ts`:

```ts
import { layout } from "./layout";
import { strings } from "./strings";

export type WelcomeArgs = {
  catalogUrl: string;
  locale: string;
  appName: string;
};

export function welcomeEmail(args: WelcomeArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).welcome;
  const body = t.body(args.appName);
  return {
    subject: t.subject(args.appName),
    text: `${body}\n\n${args.catalogUrl}\n\n${t.footer}`,
    html: layout({
      preheader: t.preheader,
      heading: t.heading,
      body,
      cta: { label: t.cta, url: args.catalogUrl },
      footer: t.footer,
      appName: args.appName,
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/mail/templates/welcome.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/templates/welcome.ts src/lib/mail/templates/welcome.test.ts
git commit -m "feat(mail): welcome email template"
```

---

## Task 11: Password-changed email template

**Files:**
- Create: `src/lib/mail/templates/password-changed.ts`
- Test: `src/lib/mail/templates/password-changed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/mail/templates/password-changed.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordChangedEmail } from "./password-changed";

test("passwordChangedEmail body includes IP and timestamp", () => {
  const m = passwordChangedEmail({
    ip: "203.0.113.4",
    at: "2026-05-26 14:00 UTC",
    locale: "en",
    appName: "NativeSpin",
  });
  assert.ok(m.text.includes("203.0.113.4"));
  assert.ok(m.text.includes("2026-05-26 14:00 UTC"));
  assert.ok(m.html!.includes("203.0.113.4"));
});

test("passwordChangedEmail has no CTA (informational only)", () => {
  const m = passwordChangedEmail({
    ip: "x",
    at: "y",
    locale: "en",
    appName: "NativeSpin",
  });
  // No href button — only the body text and footer.
  assert.equal(m.html!.match(/<a [^>]*href=/g)?.length ?? 0, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/mail/templates/password-changed.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the template**

Create `src/lib/mail/templates/password-changed.ts`:

```ts
import { layout } from "./layout";
import { strings } from "./strings";

export type PasswordChangedArgs = {
  ip: string;
  at: string;
  locale: string;
  appName: string;
};

export function passwordChangedEmail(args: PasswordChangedArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).passwordChanged;
  const body = t.body(args.ip, args.at);
  return {
    subject: t.subject(args.appName),
    text: `${body}\n\n${t.footer}`,
    html: layout({
      preheader: t.preheader,
      heading: t.heading,
      body,
      footer: t.footer,
      appName: args.appName,
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/mail/templates/password-changed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/templates/password-changed.ts src/lib/mail/templates/password-changed.test.ts
git commit -m "feat(mail): password-changed email template"
```

---

## Task 12: New-sign-in alert email template

**Files:**
- Create: `src/lib/mail/templates/new-signin-alert.ts`
- Test: `src/lib/mail/templates/new-signin-alert.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/mail/templates/new-signin-alert.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { newSigninAlertEmail } from "./new-signin-alert";

test("newSigninAlertEmail body includes the new IP", () => {
  const m = newSigninAlertEmail({
    ip: "198.51.100.7",
    at: "2026-05-26 14:00 UTC",
    resetUrl: "https://nativespin.com/en/forgot-password",
    locale: "en",
    appName: "NativeSpin",
  });
  assert.ok(m.text.includes("198.51.100.7"));
});

test("newSigninAlertEmail CTA links to the reset URL", () => {
  const url = "https://nativespin.com/en/forgot-password";
  const m = newSigninAlertEmail({
    ip: "x",
    at: "y",
    resetUrl: url,
    locale: "en",
    appName: "NativeSpin",
  });
  assert.ok(m.html!.includes(url));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/mail/templates/new-signin-alert.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the template**

Create `src/lib/mail/templates/new-signin-alert.ts`:

```ts
import { layout } from "./layout";
import { strings } from "./strings";

export type NewSigninAlertArgs = {
  ip: string;
  at: string;
  resetUrl: string;
  locale: string;
  appName: string;
};

export function newSigninAlertEmail(args: NewSigninAlertArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const t = strings(args.locale).newSigninAlert;
  const body = t.body(args.ip, args.at);
  return {
    subject: t.subject(args.appName),
    text: `${body}\n\n${args.resetUrl}\n\n${t.footer}`,
    html: layout({
      preheader: t.preheader,
      heading: t.heading,
      body,
      cta: { label: t.cta, url: args.resetUrl },
      footer: t.footer,
      appName: args.appName,
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/mail/templates/new-signin-alert.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/templates/new-signin-alert.ts src/lib/mail/templates/new-signin-alert.test.ts
git commit -m "feat(mail): new-signin-alert email template"
```

---

## Task 13: `recordSignIn` shared helper

**Files:**
- Create: `src/lib/auth-events.ts`
- Test: `src/lib/auth-events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth-events.test.ts`. We test the pure decision function `shouldAlertOnNewSignin` and leave the DB-bound `recordSignIn` for manual E2E:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAlertOnNewSignin } from "./auth-events";

test("no alert when there's no previous IP (first sign-in)", () => {
  assert.equal(shouldAlertOnNewSignin(null, "203.0.113.1"), false);
});

test("no alert when IP matches the last sign-in", () => {
  assert.equal(shouldAlertOnNewSignin("203.0.113.1", "203.0.113.1"), false);
});

test("alert when IP differs", () => {
  assert.equal(shouldAlertOnNewSignin("203.0.113.1", "198.51.100.2"), true);
});

test("no alert when current IP is unknown/empty (don't email on noise)", () => {
  assert.equal(shouldAlertOnNewSignin("203.0.113.1", ""), false);
  assert.equal(shouldAlertOnNewSignin("203.0.113.1", "unknown"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/auth-events.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the helper**

Create `src/lib/auth-events.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { emailAdapter } from "@/lib/notify";
import { newSigninAlertEmail } from "@/lib/mail/templates/new-signin-alert";
import { recordAudit } from "@/lib/audit";

// Pure decision — extracted so the policy is unit-testable.
// "unknown" / "" mean we couldn't read the IP (e.g. dev box, no proxy
// header) and we'd rather skip the alert than email on noise.
export function shouldAlertOnNewSignin(
  lastIp: string | null | undefined,
  currentIp: string,
): boolean {
  if (!currentIp || currentIp === "unknown") return false;
  if (!lastIp) return false;
  return lastIp !== currentIp;
}

export type RecordSignInArgs = {
  userId: string;
  userEmail: string;
  ip: string;
  locale: string;
  appName: string;
  resetUrl: string;
};

// Called from server actions after a successful sign-in. Compares the
// current IP to user.lastSignInIp, fires the alert email if it differs,
// and updates both lastSignInIp and lastSignInAt. Best-effort: any failure
// here is logged and swallowed.
export async function recordSignIn(args: RecordSignInArgs): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: args.userId },
      select: { lastSignInIp: true },
    });
    const now = new Date();
    const alert = shouldAlertOnNewSignin(user?.lastSignInIp ?? null, args.ip);

    await prisma.user.update({
      where: { id: args.userId },
      data: { lastSignInIp: args.ip, lastSignInAt: now },
    });

    if (alert) {
      const msg = newSigninAlertEmail({
        ip: args.ip,
        at: now.toISOString().replace("T", " ").slice(0, 16) + " UTC",
        resetUrl: args.resetUrl,
        locale: args.locale,
        appName: args.appName,
      });
      try {
        await emailAdapter({
          to: args.userEmail,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        });
      } catch (err) {
        console.error("auth.new_signin_email_failed", { userId: args.userId, err });
      }
      await recordAudit(args.userId, "auth.new_signin_alert", `User:${args.userEmail}`, {
        oldIp: user?.lastSignInIp ?? null,
        newIp: args.ip,
      });
    }
  } catch (err) {
    console.error("auth.record_signin_failed", { userId: args.userId, err });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/auth-events.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth-events.ts src/lib/auth-events.test.ts
git commit -m "feat(auth): recordSignIn helper with new-IP alert"
```

---

## Task 14: Add the `magic-link` NextAuth provider

**Files:**
- Modify: `src/auth.ts`

- [ ] **Step 1: Add imports at the top of `src/auth.ts`**

After existing imports, add:

```ts
import { hashToken } from "@/lib/tokens";
```

- [ ] **Step 2: Add the provider**

Inside the `providers: [ ... ]` array, AFTER the existing `Credentials({ ... })` block, add a second provider:

```ts
    Credentials({
      id: "magic-link",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      authorize: async (credentials) => {
        const raw = String(credentials?.token ?? "");
        if (!raw) return null;

        // Rate-limit consume by IP — defends the
        // /api/auth/callback/magic-link endpoint against brute-force.
        const ip = await authClientIp();
        const consume = await authLimiter.check(`magic-consume:ip:${ip}`);
        if (!consume.ok) return null;

        const hash = hashToken(raw);

        // updateMany with the guard clause atomically marks the token
        // consumed if and only if it's still unused + unexpired. Wins
        // double-click races: only one caller sees count === 1.
        const updated = await prisma.magicLinkToken.updateMany({
          where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        });
        if (updated.count !== 1) return null;

        const row = await prisma.magicLinkToken.findUnique({
          where: { tokenHash: hash },
          include: {
            user: {
              include: { organization: { select: { id: true, type: true } } },
            },
          },
        });
        if (!row) return null;

        if (!row.user.emailVerifiedAt) {
          await prisma.user.update({
            where: { id: row.userId },
            data: { emailVerifiedAt: new Date() },
          });
        }

        return {
          id: row.user.id,
          email: row.user.email,
          name: row.user.name ?? undefined,
          role: row.user.role,
          orgId: row.user.organization?.id ?? null,
          orgType: row.user.organization?.type ?? null,
        };
      },
    }),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/auth.ts
git commit -m "feat(auth): add magic-link credentials provider"
```

---

## Task 15: `requestMagicLink` server action

**Files:**
- Modify: `src/app/auth-actions.ts`

- [ ] **Step 1: Add imports at the top of `src/app/auth-actions.ts`**

Add to existing imports:

```ts
import { generateToken, hashToken, tokenExpiry } from "@/lib/tokens";
import { emailAdapter } from "@/lib/notify";
import { magicLinkEmail } from "@/lib/mail/templates/magic-link";
```

- [ ] **Step 2: Add a helper for canonical app URL**

Below the `clientKey` helper, add:

```ts
function appUrl(): string {
  return (
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000"
  );
}

function appName(): string {
  return process.env.AUTH_APP_NAME ?? "NativeSpin";
}
```

> **Port note:** this project's existing code falls back to `http://localhost:3000` (see `src/app/[locale]/layout.tsx`, `src/lib/publisher-invite.ts`). We mirror that for consistency. Production must set `AUTH_URL` explicitly; the fallback is dev-only.

- [ ] **Step 3: Add the server action at the end of the file**

```ts
// Magic-link sign-in: user submits email, we email them a one-tap link.
// We always redirect to /check-email, regardless of whether the email
// matched a real account, to avoid account enumeration.
export async function requestMagicLink(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();

  const ip = await clientKey();
  const [ipCheck, emailCheck] = await Promise.all([
    authLimiter.check(`magic-link:ip:${ip}`),
    authLimiter.check(`magic-link:email:${email}`),
  ]);
  if (!ipCheck.ok || !emailCheck.ok) {
    redirect(`/${locale}/signin?error=rate`);
  }

  if (!email) {
    redirect(`/${locale}/check-email`);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (user) {
    const raw = generateToken();
    await prisma.magicLinkToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: tokenExpiry(),
        requestedIp: ip,
      },
    });
    const url = `${appUrl()}/${locale}/magic-link/${raw}`;
    const msg = magicLinkEmail({ url, locale, appName: appName() });
    try {
      await emailAdapter({ to: user.email, subject: msg.subject, text: msg.text, html: msg.html });
    } catch (err) {
      console.error("auth.magic_link_email_failed", { userId: user.id, err });
    }
    await recordAudit(user.id, "auth.magic_link_requested", `User:${email}`, { ip });
  } else {
    // Don't insert; don't email. We still record an audit row so abuse
    // shows up in the log — keyed by the attempted address, not a user.
    await recordAudit(email, "auth.magic_link_requested_unknown", `User:${email}`, { ip });
  }

  redirect(`/${locale}/check-email`);
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/auth-actions.ts
git commit -m "feat(auth): requestMagicLink server action"
```

---

## Task 16: `requestPasswordReset` server action

**Files:**
- Modify: `src/app/auth-actions.ts`

- [ ] **Step 1: Add the import**

Add to the existing imports near the top:

```ts
import { passwordResetEmail } from "@/lib/mail/templates/password-reset";
```

- [ ] **Step 2: Add the server action at the end of the file**

```ts
// Password reset request: same anti-enumeration as requestMagicLink.
export async function requestPasswordReset(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();

  const ip = await clientKey();
  const [ipCheck, emailCheck] = await Promise.all([
    authLimiter.check(`reset:ip:${ip}`),
    authLimiter.check(`reset:email:${email}`),
  ]);
  if (!ipCheck.ok || !emailCheck.ok) {
    redirect(`/${locale}/forgot-password?error=rate`);
  }

  if (!email) {
    redirect(`/${locale}/check-email`);
  }

  // Only password users can reset a password. We still respond with the
  // generic /check-email page either way — never reveal whether the email
  // is registered or whether it has a password set.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true },
  });

  if (user?.passwordHash) {
    const raw = generateToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: tokenExpiry(),
        requestedIp: ip,
      },
    });
    const url = `${appUrl()}/${locale}/reset-password/${raw}`;
    const msg = passwordResetEmail({ url, locale, appName: appName() });
    try {
      await emailAdapter({ to: user.email, subject: msg.subject, text: msg.text, html: msg.html });
    } catch (err) {
      console.error("auth.password_reset_email_failed", { userId: user.id, err });
    }
    await recordAudit(user.id, "auth.password_reset_requested", `User:${email}`, { ip });
  } else {
    await recordAudit(email, "auth.password_reset_requested_unknown", `User:${email}`, { ip });
  }

  redirect(`/${locale}/check-email`);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/auth-actions.ts
git commit -m "feat(auth): requestPasswordReset server action"
```

---

## Task 17: `resetPassword` server action

**Files:**
- Modify: `src/app/auth-actions.ts`

- [ ] **Step 1: Add the import**

Add to the existing imports:

```ts
import { passwordChangedEmail } from "@/lib/mail/templates/password-changed";
```

- [ ] **Step 2: Add the server action at the end of the file**

```ts
// Consume a password-reset token: validate, update password, invalidate
// all other open reset tokens for the same user, fire the
// password-changed email, and sign the user in.
export async function resetPassword(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const token = String(formData.get("token") || "").trim();
  const newPassword = String(formData.get("password") || "");

  const ip = await clientKey();
  if (!(await authLimiter.check(`reset-consume:ip:${ip}`)).ok) {
    redirect(`/${locale}/reset-password/${token}?error=rate`);
  }

  if (!token || newPassword.length < 8) {
    redirect(`/${locale}/reset-password/${token}?error=1`);
  }

  const hash = hashToken(token);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const now = new Date();

  type Outcome =
    | { ok: true; userId: string; email: string }
    | { ok: false };

  const outcome = await prisma.$transaction<Outcome>(async (tx) => {
    // Atomic single-use consume.
    const updated = await tx.passwordResetToken.updateMany({
      where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (updated.count !== 1) return { ok: false };

    const row = await tx.passwordResetToken.findUnique({
      where: { tokenHash: hash },
      select: { userId: true, user: { select: { email: true } } },
    });
    if (!row) return { ok: false };

    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    });

    // Invalidate every other open reset token for this user.
    await tx.passwordResetToken.updateMany({
      where: { userId: row.userId, consumedAt: null, NOT: { tokenHash: hash } },
      data: { consumedAt: now },
    });

    return { ok: true, userId: row.userId, email: row.user.email };
  });

  if (!outcome.ok) {
    await recordAudit(token ? `token:${token.slice(0, 8)}…` : "anonymous", "auth.password_reset_invalid", `Token`, { ip });
    redirect(`/${locale}/reset-password/${token}?error=expired`);
  }

  await recordAudit(outcome.userId, "auth.password_reset_consumed", `User:${outcome.email}`, { ip });

  // Fire the confirmation email — best-effort.
  const msg = passwordChangedEmail({
    ip,
    at: now.toISOString().replace("T", " ").slice(0, 16) + " UTC",
    locale,
    appName: appName(),
  });
  try {
    await emailAdapter({ to: outcome.email, subject: msg.subject, text: msg.text, html: msg.html });
  } catch (err) {
    console.error("auth.password_changed_email_failed", { userId: outcome.userId, err });
  }

  // Sign the user in with their new password.
  try {
    await signIn("credentials", { email: outcome.email, password: newPassword, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/${locale}/signin`);
    }
    throw error;
  }

  // Track this sign-in.
  const { recordSignIn } = await import("@/lib/auth-events");
  await recordSignIn({
    userId: outcome.userId,
    userEmail: outcome.email,
    ip,
    locale,
    appName: appName(),
    resetUrl: `${appUrl()}/${locale}/forgot-password`,
  });

  const fresh = await prisma.user.findUnique({
    where: { id: outcome.userId },
    select: { role: true },
  });
  redirect(landingForRole(fresh?.role, locale));
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/auth-actions.ts
git commit -m "feat(auth): resetPassword server action"
```

---

## Task 18: Wire `recordSignIn` into the credentials sign-in path

**Files:**
- Modify: `src/app/auth-actions.ts`

- [ ] **Step 1: Add the import**

Add to existing imports:

```ts
import { recordSignIn } from "@/lib/auth-events";
```

- [ ] **Step 2: Update `authenticate` to call `recordSignIn` after successful sign-in**

Find the existing `authenticate` function. After the `await recordAudit(user?.id ?? email, "auth.signin", ...)` line and BEFORE the final `redirect(landingForRole(...))`, add:

```ts
  if (user?.id) {
    await recordSignIn({
      userId: user.id,
      userEmail: email,
      ip,
      locale,
      appName: appName(),
      resetUrl: `${appUrl()}/${locale}/forgot-password`,
    });
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/auth-actions.ts
git commit -m "feat(auth): wire new-signin alert into credentials sign-in"
```

---

## Task 19: Send welcome email on `register`

**Files:**
- Modify: `src/app/auth-actions.ts`

- [ ] **Step 1: Add the import**

Add to existing imports:

```ts
import { welcomeEmail } from "@/lib/mail/templates/welcome";
```

- [ ] **Step 2: Add the welcome send inside `register`**

In `register`, after the `await recordAudit(createdUserId, "user.register", ...)` line and BEFORE the `try { await signIn("credentials", ...) }`, add:

```ts
  const catalogUrl = `${appUrl()}/${locale}/catalog`;
  const welcome = welcomeEmail({ catalogUrl, locale, appName: appName() });
  try {
    await emailAdapter({ to: email, subject: welcome.subject, text: welcome.text, html: welcome.html });
  } catch (err) {
    console.error("auth.welcome_email_failed", { userId: createdUserId, err });
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/auth-actions.ts
git commit -m "feat(auth): send welcome email after signup"
```

---

## Task 20: i18n strings for new UI pages

**Files:**
- Modify: `src/messages/en.json`, `no.json`, `sv.json`, `da.json`, `de.json`, `fi.json`

- [ ] **Step 1: Add new keys to `src/messages/en.json` under the `auth` namespace**

Find the existing `"auth": { ... }` block and add (inside the same object):

```json
    "forgotLink": "Forgot password?",
    "magicLinkDivider": "or",
    "magicLinkTitle": "Sign in with a link",
    "magicLinkLead": "We'll email you a one-tap sign-in link.",
    "magicLinkButton": "Send sign-in link",
    "checkTitle": "Check your inbox",
    "checkLead": "If that email is registered, we just sent a link. It expires in 15 minutes.",
    "forgotTitle": "Reset your password",
    "forgotLead": "Enter your email and we'll send you a link to set a new password.",
    "forgotButton": "Send reset link",
    "resetTitle": "Set a new password",
    "resetButton": "Update password",
    "resetExpired": "This link has expired or was already used. Request a new one.",
    "magicLinkExpired": "This sign-in link has expired or was already used.",
    "backToSignin": "Back to sign in"
```

- [ ] **Step 2: Copy the same keys to the other five locale files**

For each of `no.json`, `sv.json`, `da.json`, `de.json`, `fi.json`, add the same keys with the same English strings as placeholders. (Translation can happen later — TypeScript's `next-intl` type-gen catches missing keys.) Use the same JSON edit pattern.

- [ ] **Step 3: Verify the messages files are valid JSON**

Run: `for f in src/messages/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BROKEN: $f"; done`
Expected: no "BROKEN" output.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/messages/
git commit -m "feat(auth): i18n strings for magic-link and password-reset UI"
```

---

## Task 21: `/[locale]/check-email` page

**Files:**
- Create: `src/app/[locale]/(marketing)/check-email/page.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/[locale]/(marketing)/check-email/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";

export const dynamic = "force-dynamic";

export default async function CheckEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <LandingShell locale={locale} screenLabel="Check email">
      <section className="auth-shell">
        <div className="auth-card" style={{ maxWidth: 440 }}>
          <div className="head">
            <h2>{t("checkTitle")}</h2>
            <p>{t("checkLead")}</p>
          </div>
          <div className="alt">
            <Link href="/signin">{t("backToSignin")}</Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Smoke test in browser**

Run: `pnpm dev` (let the existing project-configured port stand)
Visit `http://localhost:<port>/en/check-email`
Expected: the "Check your inbox" card renders with localized copy.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/\(marketing\)/check-email/
git commit -m "feat(auth): /check-email confirmation page"
```

---

## Task 22: `/[locale]/forgot-password` page

**Files:**
- Create: `src/app/[locale]/(marketing)/forgot-password/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requestPasswordReset } from "@/app/auth-actions";
import { LandingShell } from "@/app/landing-shell";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "auth" });

  const rateLimited = sp.error === "rate";

  return (
    <LandingShell locale={locale} screenLabel="Forgot password">
      <section className="auth-shell">
        <div className="auth-card" style={{ maxWidth: 440 }}>
          <div className="head">
            <h2>{t("forgotTitle")}</h2>
            <p>{t("forgotLead")}</p>
          </div>

          {rateLimited ? (
            <div className="banner-error" role="alert">
              <span>{t("failed")}</span>
            </div>
          ) : null}

          <form action={requestPasswordReset} noValidate>
            <input type="hidden" name="locale" value={locale} />
            <div className="field">
              <label htmlFor="email">{t("email")}</label>
              <input id="email" name="email" type="email" autoComplete="email" autoFocus required />
            </div>
            <div className="actions">
              <button type="submit" className="btn primary block">
                {t("forgotButton")}
              </button>
            </div>
          </form>

          <div className="alt">
            <Link href="/signin">{t("backToSignin")}</Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Smoke test in browser**

Visit `http://localhost:<port>/en/forgot-password`
Expected: form renders. Don't submit yet — Task 26 covers the end-to-end walk.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/\(marketing\)/forgot-password/
git commit -m "feat(auth): /forgot-password page"
```

---

## Task 23: `/[locale]/reset-password/[token]` page

**Files:**
- Create: `src/app/[locale]/(marketing)/reset-password/[token]/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { resetPassword } from "@/app/auth-actions";
import { LandingShell } from "@/app/landing-shell";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, token } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "auth" });

  // Server-side validate the token before rendering the form.
  // The form's POST re-validates (defense in depth).
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { consumedAt: true, expiresAt: true },
  });
  const invalid =
    !row ||
    row.consumedAt != null ||
    row.expiresAt.getTime() <= Date.now();

  if (invalid) {
    return (
      <LandingShell locale={locale} screenLabel="Reset password">
        <section className="auth-shell">
          <div className="auth-card" style={{ maxWidth: 440 }}>
            <div className="head">
              <h2>{t("resetExpired")}</h2>
            </div>
            <div className="alt">
              <Link href="/forgot-password">{t("forgotButton")}</Link>
            </div>
          </div>
        </section>
      </LandingShell>
    );
  }

  const errorKind = sp.error;

  return (
    <LandingShell locale={locale} screenLabel="Reset password">
      <section className="auth-shell">
        <div className="auth-card" style={{ maxWidth: 440 }}>
          <div className="head">
            <h2>{t("resetTitle")}</h2>
          </div>

          {errorKind === "rate" || errorKind === "1" ? (
            <div className="banner-error" role="alert">
              <span>{t("failed")}</span>
            </div>
          ) : null}
          {errorKind === "expired" ? (
            <div className="banner-error" role="alert">
              <span>{t("resetExpired")}</span>
            </div>
          ) : null}

          <form action={resetPassword} noValidate>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <div className="field">
              <label htmlFor="password">{t("password")}</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                autoFocus
              />
            </div>
            <div className="actions">
              <button type="submit" className="btn primary block">
                {t("resetButton")}
              </button>
            </div>
          </form>
        </div>
      </section>
    </LandingShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Smoke test in browser**

Visit `http://localhost:<port>/en/reset-password/nonsense`
Expected: "this link has expired or was already used" card with a link back to forgot-password.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/\(marketing\)/reset-password/
git commit -m "feat(auth): /reset-password/[token] page"
```

---

## Task 24: `/[locale]/magic-link/[token]` page

**Files:**
- Create: `src/app/[locale]/magic-link/[token]/page.tsx`

> **Note:** this page lives directly under `[locale]`, not under `(marketing)`. It is not a user-facing surface — it's a thin server-side consumer of the token.

- [ ] **Step 1: Create the page**

```tsx
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";
import { landingForRole } from "@/lib/roles";
import { hashToken } from "@/lib/tokens";
import { recordSignIn } from "@/lib/auth-events";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

function appUrl(): string {
  return (
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000"
  );
}

function appName(): string {
  return process.env.AUTH_APP_NAME ?? "NativeSpin";
}

export default async function MagicLinkPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  const ip = await clientIp();

  // The Credentials provider performs the atomic consume. If it fails
  // (token invalid, already consumed, expired), signIn throws AuthError;
  // we catch and render the inline error state.
  let signedIn = false;
  try {
    await signIn("magic-link", { token, redirect: false });
    signedIn = true;
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    await recordAudit("anonymous", "auth.magic_link_invalid", "Token", { ip });
    return (
      <LandingShell locale={locale} screenLabel="Sign in">
        <section className="auth-shell">
          <div className="auth-card" style={{ maxWidth: 440 }}>
            <div className="head">
              <h2>{t("magicLinkExpired")}</h2>
            </div>
            <div className="alt">
              <Link href="/signin">{t("backToSignin")}</Link>
            </div>
          </div>
        </section>
      </LandingShell>
    );
  }

  // Look up the just-consumed token row to find the user. We don't rely
  // on `auth()` here because the freshly issued session cookie may not be
  // readable inside the same request via that helper. The token row's
  // userId is the source of truth for "who just signed in".
  const row = await prisma.magicLinkToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      userId: true,
      user: { select: { id: true, email: true, role: true } },
    },
  });
  if (!row?.user) {
    redirect(`/${locale}/signin`);
  }

  await recordAudit(row.user.id, "auth.magic_link_consumed", `User:${row.user.email}`, { ip });

  await recordSignIn({
    userId: row.user.id,
    userEmail: row.user.email,
    ip,
    locale,
    appName: appName(),
    resetUrl: `${appUrl()}/${locale}/forgot-password`,
  });

  redirect(landingForRole(row.user.role, locale));
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Smoke test in browser**

Visit `http://localhost:<port>/en/magic-link/nonsense`
Expected: "this sign-in link has expired" card.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/magic-link/
git commit -m "feat(auth): /magic-link/[token] consume page"
```

---

## Task 25: Update `/[locale]/signin` to add magic-link form + forgot link

**Files:**
- Modify: `src/app/[locale]/(marketing)/signin/page.tsx`

- [ ] **Step 1: Add the import for the new server action**

Edit the imports at the top of the file. Change:

```ts
import { authenticate } from "@/app/auth-actions";
```

to:

```ts
import { authenticate, requestMagicLink } from "@/app/auth-actions";
```

- [ ] **Step 2: Add the forgot-password link below the password form's submit button**

Find the `<div className="actions">` containing the existing submit button. Right AFTER the closing `</form>` of the password form, add:

```tsx
          <div className="alt" style={{ marginTop: 8 }}>
            <Link href="/forgot-password">{t("forgotLink")}</Link>
          </div>
```

- [ ] **Step 3: Add the magic-link form**

AFTER the forgot-password link (above the existing `<div className="alt">` with "noAccount"), add:

```tsx
          <div className="divider" role="separator" aria-hidden="true" style={{ margin: "20px 0", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
            {t("magicLinkDivider")}
          </div>

          <div className="head" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 18 }}>{t("magicLinkTitle")}</h2>
            <p>{t("magicLinkLead")}</p>
          </div>

          <form action={requestMagicLink} noValidate>
            <input type="hidden" name="locale" value={locale} />
            <div className="field">
              <label htmlFor="magic-email">{t("email")}</label>
              <input id="magic-email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="actions">
              <button type="submit" className="btn secondary block">
                {t("magicLinkButton")}
              </button>
            </div>
          </form>
```

> **Style note:** the `.btn.secondary` class may or may not exist in the existing stylesheet. If it doesn't, fall back to `className="btn primary block"` — they'll look identical for now. Avoid creating new CSS classes for this iteration; the divider's inline styles are a deliberate, small concession to keep the diff focused.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 5: Smoke test in browser**

Visit `http://localhost:<port>/en/signin`
Expected: password form + "forgot password?" link + divider + magic-link form, all visible.

- [ ] **Step 6: Commit**

```bash
git add src/app/[locale]/\(marketing\)/signin/page.tsx
git commit -m "feat(auth): add magic-link form + forgot-password link to /signin"
```

---

## Task 26: `.env.example` and ENV docs

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the new env vars**

Check whether `.env.example` exists:

Run: `ls /Users/andreashatlem/Native/.env.example 2>/dev/null || echo "MISSING"`

If it exists, append:

```
# --- Auth emails (Resend) ---
# Optional in dev — when unset, emails are logged to the console only.
RESEND_API_KEY=
AUTH_EMAIL_FROM="NativeSpin <noreply@nativespin.com>"
AUTH_EMAIL_REPLY_TO=
AUTH_APP_NAME="NativeSpin"
```

If it does NOT exist, create it with at least the four lines above (this is fine — Next.js will simply ignore an unrecognised file outside `.env.local`).

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: env vars for resend + auth email branding"
```

---

## Task 27: Cleanup script

**Files:**
- Create: `scripts/cleanup-auth-tokens.ts`

- [ ] **Step 1: Create the script**

```ts
// Deletes consumed or expired auth tokens older than 30 days.
// Run on demand: `pnpm tsx scripts/cleanup-auth-tokens.ts`.
// Cron later if/when the tables grow.

import { prisma } from "@/lib/prisma";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function main() {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  const ml = await prisma.magicLinkToken.deleteMany({
    where: {
      OR: [{ consumedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
    },
  });

  const pr = await prisma.passwordResetToken.deleteMany({
    where: {
      OR: [{ consumedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
    },
  });

  console.log(`Cleaned up: magicLink=${ml.count} passwordReset=${pr.count}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 2: Verify it runs (against the dev DB) — should report 0/0 the first time**

Run: `pnpm tsx scripts/cleanup-auth-tokens.ts`
Expected: `Cleaned up: magicLink=0 passwordReset=0` (no errors).

- [ ] **Step 3: Commit**

```bash
git add scripts/cleanup-auth-tokens.ts
git commit -m "chore(auth): cleanup script for stale tokens"
```

---

## Task 28: Manual E2E checklist doc

**Files:**
- Create: `docs/testing/auth-flows.md`

- [ ] **Step 1: Create the checklist**

```markdown
# Manual E2E checklist — auth flows

Run this checklist before shipping a release that touches auth.

## Setup

1. Set `RESEND_API_KEY` to a real Resend test key (or use a Resend dashboard with "test mode" enabled).
2. Set `AUTH_EMAIL_FROM` to an address Resend will accept for your verified domain.
3. Have a seeded test user — e.g. `buyer@nativespin.com`.

## Magic link sign-in

- [ ] Visit `/en/signin`, scroll to the magic-link form
- [ ] Enter `buyer@nativespin.com`, click "Send sign-in link"
- [ ] Redirected to `/en/check-email`
- [ ] Check the Resend dashboard — one delivery to `buyer@nativespin.com`
- [ ] Click the link in the email → land on `/en/catalog` (or the seeded user's landing page)
- [ ] Reload the same link → "this sign-in link has expired" page renders
- [ ] Repeat with an UNKNOWN email — still redirects to `/en/check-email`, NO email is sent

## Password reset

- [ ] Visit `/en/signin`, click "Forgot password?"
- [ ] Enter `buyer@nativespin.com`, submit
- [ ] Redirected to `/en/check-email`
- [ ] Click reset link in the email → "set a new password" form renders
- [ ] Submit a new password (≥8 chars) → signed in + redirected to `/en/catalog`
- [ ] Check inbox for a "your password was changed" email
- [ ] Try to sign in with the OLD password — fails
- [ ] Sign in with the NEW password — works
- [ ] Reload the now-consumed reset link → "this link has expired" page renders

## New-sign-in alert

- [ ] Sign in via password from your usual IP — no alert email
- [ ] Sign in from a different network (mobile tether, VPN, second device) — alert email arrives with the new IP
- [ ] The alert email's "reset password" button leads to `/en/forgot-password`

## Welcome email

- [ ] Open `/en/signup` in a private browsing window
- [ ] Create a new account
- [ ] Welcome email arrives with a "browse the catalog" button pointing at `/en/catalog`

## Rate limiting

- [ ] Send 10 magic-link requests in quick succession for the same email — the later ones redirect to `/en/signin?error=rate`
- [ ] Submit 10 password-reset requests from the same IP — same outcome

## i18n

- [ ] Visit `/no/signin` and `/de/signin` — UI renders without missing-translation warnings in the dev console
- [ ] (Translation of email copy is a follow-up — emails will still send in English until `src/lib/mail/templates/strings.ts` is filled in for non-`en` locales.)
```

- [ ] **Step 2: Commit**

```bash
mkdir -p docs/testing
git add docs/testing/auth-flows.md
git commit -m "docs(testing): manual E2E checklist for auth flows"
```

---

## Final validation

- [ ] **Step 1: Run all unit tests**

Run: `pnpm test`
Expected: all tests pass, including the new ones for `tokens`, `auth-events`, `resend`, and the five email templates.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: build succeeds with no auth-related warnings.

- [ ] **Step 5: Walk through the manual E2E checklist**

Open `docs/testing/auth-flows.md` and tick every box.

- [ ] **Step 6: Final commit (if any uncommitted changes remain)**

```bash
git status
# if clean, you're done. If anything pending, decide whether it belongs in a follow-up.
```

---

## Out of scope (deferred)

- Translation of email copy into `no`, `sv`, `da`, `de`, `fi` (strings stubbed as `en`)
- "Change password" UI for signed-in users
- Account lockout after N invalid consumes
- User-agent fingerprinting on new-signin alert
- Email verification gate on signup
- Cron schedule for the cleanup script (run manually or wire to Railway scheduled job later)
