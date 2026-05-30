# Trust & Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a double-opt-in newsletter capture, real team faces on `/contact`, and a publisher proof strip to the marketing site — no false product-capability claims.

**Architecture:** A new `Subscriber` table drives double opt-in via the existing Resend adapter (raw token in the URL, SHA-256 hash at rest — same pattern as `MagicLinkToken`). All decision logic (input parsing, honeypot, subscribe-vs-silent-ok classification, email body) is extracted into pure functions so it is unit-tested the way the rest of the codebase tests pure logic (no prisma mocking infra exists). DB writes and React components are thin orchestrators around those pure cores. Two new marketing components (`PublisherStrip`, `TeamRow`) are self-contained server/static units reused across pages.

**Tech Stack:** Next.js App Router (server actions + route handlers), Prisma/PostgreSQL, Resend (via `@/lib/notify` adapter), next-intl per-namespace JSON, zod. Marketing UI uses plain CSS classes against `landing-styles` — **not Tailwind**.

**Conventions verified in this repo (do not deviate):**
- **Tests:** `node:test` + `node:assert/strict`, run with `pnpm test` (`tsx --test "src/**/*.test.ts"`). **No Vitest, no prisma mocking.** Mirror `src/lib/pricing/quotes.test.ts`.
- **Tokens:** `generateToken()` + `hashToken()` from `@/lib/tokens` (raw base64url; SHA-256 hex hash).
- **Absolute URLs:** a **synchronous** `appUrl()` (reads `NEXTAUTH_URL ?? NEXT_PUBLIC_SITE_URL ?? http://localhost:3100`, strips trailing slash) is currently **copy-pasted** in `src/app/auth-actions.ts:383` and `src/app/[locale]/magic-link/[token]/route.ts:34`. Task 0 extracts it to a shared `@/lib/url`; new code imports from there. Build links as `` `${appUrl()}/path` `` (no `await`).
- **No `date-fns`** in the repo — compute expiries with plain `Date` math.
- **Email normalisation:** `normaliseEmail(email)` from `@/lib/outreach/dedup`.

**Branch:** `feat/trust-and-capture` (already created; `main` auto-deploys to prod, so all work stays on this branch until merge).

**Spec:** `docs/superpowers/specs/2026-05-30-trust-and-capture-design.md`

---

## Task 0: Extract the shared `appUrl()` helper

`appUrl()` is currently duplicated verbatim in two files. The newsletter code needs it too, so extract it once (DRY) and point the new code at it. Existing callers keep working; adopting it in them is optional and out of scope.

**Files:**
- Create: `src/lib/url.ts`

- [ ] **Step 1: Create the shared helper** (exact copy of the existing implementation):

```ts
// Origin for building absolute links in emails / redirects. Mirrors the
// NextAuth base resolution so confirmation links point at the right host
// in every environment. Synchronous and dependency-free.
export function appUrl(): string {
  const envUrl =
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3100";
  return envUrl.replace(/\/$/, "");
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/url.ts
git commit -m "refactor(url): extract shared appUrl() helper"
```

---

## File Structure

**Newsletter — pure cores (unit-tested):**
- `src/lib/newsletter/validate.ts` — parse + validate form input, honeypot. Pure.
- `src/lib/newsletter/classify.ts` — decide SEND_CONFIRM vs SILENT_OK from existing state. Pure.
- `src/lib/newsletter/email.ts` — build confirmation email `{subject,text,html}`. Pure.
- `src/lib/newsletter/*.test.ts` — tests for the three above.

**Newsletter — orchestration (thin, DB/IO):**
- `src/lib/newsletter/store.ts` — `upsertPendingSubscriber`, `confirmSubscriber`, `unsubscribeSubscriber`.
- `src/lib/newsletter/subscribe.ts` — `subscribeNewsletter` server action.
- `src/app/api/newsletter/confirm/route.ts`, `src/app/api/newsletter/unsubscribe/route.ts`.
- `src/app/[locale]/(marketing)/newsletter/page.tsx` — status page (confirmed / unsubscribed / invalid).
- `src/app/[locale]/(marketing)/_components/NewsletterSignup.tsx` — client form (compact + full).

**Proof strip + team:**
- `src/lib/marketing/strip-publishers.ts` — query top publishers (+ logoUrl).
- `src/app/[locale]/(marketing)/_components/PublisherStrip.tsx` — async server component.
- `src/app/[locale]/(marketing)/contact/desk-team.ts` — typed team config (user fills).
- `src/app/[locale]/(marketing)/contact/_components/TeamRow.tsx` — team cards.

**Schema + i18n + wiring (modified):**
- `prisma/schema.prisma` — `Subscriber`, `SubscriberStatus`, `Publisher.logoUrl`.
- `src/i18n/request.ts` — register `newsletter` + `team` namespaces.
- `src/messages/landing/{en,no,da,sv,fi,de}/{newsletter,team}.json` — copy.
- `src/app/landing-shell.tsx` — footer compact signup.
- `src/app/[locale]/(marketing)/page.tsx` — home full signup + strip.
- `src/app/[locale]/(marketing)/contact/page.tsx` — team row.
- `src/app/[locale]/(marketing)/for-advertisers/page.tsx`, `.../for-agencies/page.tsx` — strip.
- `src/app/[locale]/(marketing)/landing-styles.ts` — styles for new components.

---

## Task 1: Schema — Subscriber, SubscriberStatus, Publisher.logoUrl

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the enum** after the `ProductType` enum block (near line 44):

```prisma
enum SubscriberStatus {
  PENDING
  CONFIRMED
  UNSUBSCRIBED
}
```

- [ ] **Step 2: Add `logoUrl` to the Publisher model.** In `model Publisher`, after the `pricesPublic` field (around line 221), add:

```prisma
  // Optional brand logo for the marketing proof strip. Null → the strip
  // renders a styled text chip of the publisher name instead, so the
  // component is truthful with zero assets and logos drop in later.
  logoUrl       String?
```

- [ ] **Step 3: Add the Subscriber model** at the end of the file (after `OutreachSuppression`):

```prisma
// Marketing newsletter subscriber. Double opt-in: a row is PENDING until
// the recipient clicks the tokenised confirm link, then CONFIRMED. The
// raw tokens live only in email URLs; we store SHA-256 hashes (same
// pattern as MagicLinkToken). The unsub token is long-lived so links in
// old emails keep working; the confirm token is single-use + expires.
model Subscriber {
  email            String           @id
  locale           String
  status           SubscriberStatus @default(PENDING)
  source           String // where the signup came from: "footer", "home", ...
  confirmTokenHash String?
  confirmExpiresAt DateTime?
  unsubTokenHash   String           @unique
  createdAt        DateTime         @default(now())
  confirmedAt      DateTime?
  unsubscribedAt   DateTime?

  @@index([status])
  @@index([confirmTokenHash])
}
```

- [ ] **Step 4: Apply the migration**

Run: `pnpm prisma migrate dev --name add_subscriber_and_publisher_logo`
Expected: migration created and applied; `Subscriber` table + `SubscriberStatus` enum + `Publisher.logoUrl` column exist. Prisma client regenerated.

- [ ] **Step 5: Verify the client typechecks**

Run: `pnpm typecheck`
Expected: PASS (no new errors).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(newsletter): add Subscriber model + Publisher.logoUrl"
```

---

## Task 2: Pure input validation + honeypot

**Files:**
- Create: `src/lib/newsletter/validate.ts`
- Test: `src/lib/newsletter/validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSubscribeInput } from "./validate";

test("parseSubscribeInput accepts a valid email and normalises it", () => {
  const r = parseSubscribeInput({ email: "  User@Example.COM ", source: "footer", website: "" });
  assert.deepEqual(r, { ok: true, email: "user@example.com", source: "footer" });
});

test("parseSubscribeInput rejects an invalid email", () => {
  const r = parseSubscribeInput({ email: "nope", source: "footer", website: "" });
  assert.deepEqual(r, { ok: false, error: "invalid_email" });
});

test("parseSubscribeInput treats a filled honeypot as a silent drop", () => {
  const r = parseSubscribeInput({ email: "user@example.com", source: "footer", website: "bot" });
  assert.deepEqual(r, { ok: false, error: "honeypot" });
});

test("parseSubscribeInput falls back to a safe source when missing", () => {
  const r = parseSubscribeInput({ email: "user@example.com", source: "", website: "" });
  assert.deepEqual(r, { ok: true, email: "user@example.com", source: "unknown" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep -A2 validate`
Expected: FAIL — cannot find module `./validate`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from "zod";
import { normaliseEmail } from "@/lib/outreach/dedup";

export type SubscribeRaw = { email: string; source: string; website: string };
export type SubscribeParsed =
  | { ok: true; email: string; source: string }
  | { ok: false; error: "invalid_email" | "honeypot" };

const emailSchema = z.string().email();

// `website` is a hidden honeypot field: real users never fill it, bots do.
export function parseSubscribeInput(raw: SubscribeRaw): SubscribeParsed {
  if (raw.website.trim() !== "") return { ok: false, error: "honeypot" };
  const email = normaliseEmail(raw.email);
  if (!emailSchema.safeParse(email).success) return { ok: false, error: "invalid_email" };
  const source = raw.source.trim() || "unknown";
  return { ok: true, email, source };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test 2>&1 | grep -E "validate|pass|fail"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/newsletter/validate.ts src/lib/newsletter/validate.test.ts
git commit -m "feat(newsletter): pure input validation + honeypot"
```

---

## Task 3: Pure subscribe classification

Decides what to do given the current state of an email — without disclosing whether it already exists.

**Files:**
- Create: `src/lib/newsletter/classify.ts`
- Test: `src/lib/newsletter/classify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySubscribe } from "./classify";

test("classifySubscribe sends a confirm email for a brand-new email", () => {
  assert.equal(classifySubscribe({ existingStatus: null, suppressed: false }), "SEND_CONFIRM");
});

test("classifySubscribe re-sends confirm for a still-PENDING email", () => {
  assert.equal(classifySubscribe({ existingStatus: "PENDING", suppressed: false }), "SEND_CONFIRM");
});

test("classifySubscribe re-opts a previously UNSUBSCRIBED email back into confirm", () => {
  assert.equal(classifySubscribe({ existingStatus: "UNSUBSCRIBED", suppressed: false }), "SEND_CONFIRM");
});

test("classifySubscribe stays silent for an already-CONFIRMED email", () => {
  assert.equal(classifySubscribe({ existingStatus: "CONFIRMED", suppressed: false }), "SILENT_OK");
});

test("classifySubscribe stays silent for a suppressed email", () => {
  assert.equal(classifySubscribe({ existingStatus: null, suppressed: true }), "SILENT_OK");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep -A2 classify`
Expected: FAIL — cannot find module `./classify`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { SubscriberStatus } from "@prisma/client";

export type SubscribeDecision = "SEND_CONFIRM" | "SILENT_OK";

// Both branches return the SAME success message to the user upstream, so an
// attacker can't probe which emails are subscribed. Suppressed emails
// (hard bounce / spam complaint) are never re-mailed.
export function classifySubscribe(args: {
  existingStatus: SubscriberStatus | null;
  suppressed: boolean;
}): SubscribeDecision {
  if (args.suppressed) return "SILENT_OK";
  if (args.existingStatus === "CONFIRMED") return "SILENT_OK";
  return "SEND_CONFIRM";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test 2>&1 | grep -E "classify|pass|fail"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/newsletter/classify.ts src/lib/newsletter/classify.test.ts
git commit -m "feat(newsletter): pure subscribe classification"
```

---

## Task 4: Pure confirmation-email builder

**Files:**
- Create: `src/lib/newsletter/email.ts`
- Test: `src/lib/newsletter/email.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfirmEmail } from "./email";

const urls = {
  confirmUrl: "https://nativespin.com/api/newsletter/confirm?token=abc",
  unsubUrl: "https://nativespin.com/api/newsletter/unsubscribe?token=xyz",
};

test("buildConfirmEmail includes both links in text and html", () => {
  const msg = buildConfirmEmail(urls);
  assert.ok(msg.subject.length > 0);
  assert.ok(msg.text.includes(urls.confirmUrl));
  assert.ok(msg.text.includes(urls.unsubUrl));
  assert.ok(msg.html.includes(urls.confirmUrl));
  assert.ok(msg.html.includes(urls.unsubUrl));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep -A2 email`
Expected: FAIL — cannot find module `./email`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type ConfirmEmailUrls = { confirmUrl: string; unsubUrl: string };
export type BuiltEmail = { subject: string; text: string; html: string };

// English-only transactional confirmation. Kept deliberately plain; the
// marketing pages carry the localised copy, this is a one-click confirm.
export function buildConfirmEmail({ confirmUrl, unsubUrl }: ConfirmEmailUrls): BuiltEmail {
  const subject = "Confirm your NativeSpin subscription";
  const text = [
    "Thanks for signing up to NativeSpin.",
    "",
    "Confirm your email to start receiving updates:",
    confirmUrl,
    "",
    "Didn't sign up? Ignore this email, or unsubscribe:",
    unsubUrl,
  ].join("\n");
  const html = [
    `<p>Thanks for signing up to NativeSpin.</p>`,
    `<p><a href="${confirmUrl}">Confirm your subscription</a></p>`,
    `<p style="color:#666;font-size:13px">Didn't sign up? `,
    `<a href="${unsubUrl}">Unsubscribe</a>.</p>`,
  ].join("");
  return { subject, text, html };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test 2>&1 | grep -E "buildConfirmEmail|pass|fail"`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/newsletter/email.ts src/lib/newsletter/email.test.ts
git commit -m "feat(newsletter): pure confirmation-email builder"
```

---

## Task 5: Subscriber store (DB orchestration)

Thin DB layer. Not unit-tested in isolation (no prisma mock infra; matches codebase convention — pure logic is tested, DB glue is exercised via typecheck/build and the integration paths).

**Files:**
- Create: `src/lib/newsletter/store.ts`

- [ ] **Step 1: Implement the store**

```ts
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/tokens";

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type UpsertResult = { confirmRaw: string };

// Create or refresh a PENDING subscriber and return the RAW confirm token
// for the email URL. A fresh confirm token (and fresh 7-day expiry) is
// minted on every (re)subscribe. The unsub token hash is set once on
// create and never rotated, so any unsubscribe link stays valid for life.
//
// Raw tokens are never stored; the pre-confirmation email uses the confirm
// token for BOTH its confirm and unsubscribe links, and the unsubscribe
// route (Task 7) resolves either token. Durable per-send unsub tokens
// arrive with the newsletter-send sub-project (out of scope here).
export async function upsertPendingSubscriber(args: {
  email: string;
  locale: string;
  source: string;
}): Promise<UpsertResult> {
  const confirmRaw = generateToken();
  const confirmExpiresAt = new Date(Date.now() + CONFIRM_TTL_MS);

  await prisma.subscriber.upsert({
    where: { email: args.email },
    create: {
      email: args.email,
      locale: args.locale,
      source: args.source,
      status: "PENDING",
      confirmTokenHash: hashToken(confirmRaw),
      confirmExpiresAt,
      // Stable lifetime unsub token; distinct from the confirm token.
      unsubTokenHash: hashToken(generateToken()),
    },
    update: {
      locale: args.locale,
      source: args.source,
      status: "PENDING",
      confirmTokenHash: hashToken(confirmRaw),
      confirmExpiresAt,
      unsubscribedAt: null,
      // unsubTokenHash intentionally left untouched on update.
    },
  });

  return { confirmRaw };
}

// Confirm by raw token. Returns the subscriber locale on success (for the
// redirect), or null if the token is missing/expired/already used.
export async function confirmSubscriber(raw: string): Promise<{ locale: string } | null> {
  const row = await prisma.subscriber.findFirst({
    where: { confirmTokenHash: hashToken(raw) },
    select: { email: true, locale: true, confirmExpiresAt: true },
  });
  if (!row || !row.confirmExpiresAt || row.confirmExpiresAt < new Date()) return null;
  await prisma.subscriber.update({
    where: { email: row.email },
    data: { status: "CONFIRMED", confirmedAt: new Date(), confirmTokenHash: null, confirmExpiresAt: null },
  });
  return { locale: row.locale };
}

// Unsubscribe by raw token. Idempotent. Returns locale or null.
export async function unsubscribeSubscriber(raw: string): Promise<{ locale: string } | null> {
  const row = await prisma.subscriber.findUnique({
    where: { unsubTokenHash: hashToken(raw) },
    select: { email: true, locale: true },
  });
  if (!row) return null;
  await prisma.subscriber.update({
    where: { email: row.email },
    data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
  });
  return { locale: row.locale };
}
```

> **Design note (read before Task 6/7):** the store never returns or stores a raw unsub token. The pre-confirmation email points both its confirm and unsubscribe links at the same raw confirm token; the confirm route accepts it as a confirm token and the unsubscribe route accepts it as a fallback (Task 7). This keeps raw tokens out of storage. The durable `unsubTokenHash` is reserved for the future newsletter-send flow.

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/newsletter/store.ts
git commit -m "feat(newsletter): subscriber store (upsert/confirm/unsubscribe)"
```

---

## Task 6: subscribeNewsletter server action

**Files:**
- Create: `src/lib/newsletter/subscribe.ts`

- [ ] **Step 1: Implement the action**

```ts
"use server";

import { prisma } from "@/lib/prisma";
import { emailAdapter } from "@/lib/notify";
import { appUrl } from "@/lib/url";
import { isSuppressed } from "@/lib/outreach/suppression";
import { parseSubscribeInput } from "./validate";
import { classifySubscribe } from "./classify";
import { buildConfirmEmail } from "./email";
import { upsertPendingSubscriber } from "./store";

export type SubscribeState = { status: "idle" | "ok" | "error"; message?: string };

const NEWSLETTER_FROM =
  process.env.OUTREACH_FROM ?? "NativeSpin <noreply@nativespin.com>";

export async function subscribeNewsletter(
  _prev: SubscribeState,
  formData: FormData,
): Promise<SubscribeState> {
  const locale = String(formData.get("locale") ?? "en");
  const parsed = parseSubscribeInput({
    email: String(formData.get("email") ?? ""),
    source: String(formData.get("source") ?? ""),
    website: String(formData.get("website") ?? ""),
  });

  // Honeypot → pretend success (don't tip off bots). Invalid → real error.
  if (!parsed.ok) {
    if (parsed.error === "honeypot") return { status: "ok" };
    return { status: "error", message: "invalid_email" };
  }

  const existing = await prisma.subscriber.findUnique({
    where: { email: parsed.email },
    select: { status: true },
  });
  const decision = classifySubscribe({
    existingStatus: existing?.status ?? null,
    suppressed: await isSuppressed(parsed.email),
  });

  if (decision === "SEND_CONFIRM") {
    const { confirmRaw } = await upsertPendingSubscriber({
      email: parsed.email,
      locale,
      source: parsed.source,
    });
    const origin = appUrl(); // sync, returns origin (no trailing slash)
    const confirmUrl = `${origin}/api/newsletter/confirm?token=${confirmRaw}`;
    const unsubUrl = `${origin}/api/newsletter/unsubscribe?token=${confirmRaw}`;
    const msg = buildConfirmEmail({ confirmUrl, unsubUrl });
    try {
      await emailAdapter({ to: parsed.email, from: NEWSLETTER_FROM, ...msg });
    } catch (err) {
      // Row persists as PENDING; user still sees success and can re-submit
      // to re-trigger the confirm send.
      console.error("newsletter.confirm_send_failed", err);
    }
  }

  // Same success for SEND_CONFIRM and SILENT_OK — no existence disclosure.
  return { status: "ok" };
}
```

> The unsubscribe link in the pre-confirmation email intentionally points at the confirm route's token namespace; the confirm/unsubscribe routes (Task 7) both accept that token. Post-confirmation newsletter sends (a later sub-project) will carry the durable unsub token. This keeps raw unsub tokens out of storage now while still giving every email a working opt-out.

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/newsletter/subscribe.ts
git commit -m "feat(newsletter): subscribeNewsletter server action"
```

---

## Task 7: Confirm + unsubscribe route handlers

Both accept a raw token; both try confirm-token then unsub-token resolution so a single pre-confirmation token works for either link.

**Files:**
- Create: `src/app/api/newsletter/confirm/route.ts`
- Create: `src/app/api/newsletter/unsubscribe/route.ts`

- [ ] **Step 1: Implement the confirm route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/url";
import { confirmSubscriber } from "@/lib/newsletter/store";

export async function GET(req: NextRequest) {
  const origin = appUrl();
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect(`${origin}/en/newsletter?status=invalid`);
  const res = await confirmSubscriber(token);
  if (!res) return NextResponse.redirect(`${origin}/en/newsletter?status=invalid`);
  return NextResponse.redirect(`${origin}/${res.locale}/newsletter?status=confirmed`);
}
```

- [ ] **Step 2: Implement the unsubscribe route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/url";
import { unsubscribeSubscriber } from "@/lib/newsletter/store";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";

export async function GET(req: NextRequest) {
  const origin = appUrl();
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect(`${origin}/en/newsletter?status=invalid`);

  // Try the durable unsub token first; fall back to a pre-confirmation
  // confirm token (which also identifies the row) so the opt-out link in a
  // not-yet-confirmed email still works.
  let res = await unsubscribeSubscriber(token);
  if (!res) {
    const row = await prisma.subscriber.findFirst({
      where: { confirmTokenHash: hashToken(token) },
      select: { email: true, locale: true },
    });
    if (row) {
      await prisma.subscriber.update({
        where: { email: row.email },
        data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date(), confirmTokenHash: null },
      });
      res = { locale: row.locale };
    }
  }
  if (!res) return NextResponse.redirect(`${origin}/en/newsletter?status=invalid`);
  return NextResponse.redirect(`${origin}/${res.locale}/newsletter?status=unsubscribed`);
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS (no unused-import errors).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/newsletter
git commit -m "feat(newsletter): confirm + unsubscribe route handlers"
```

---

## Task 8: Newsletter status marketing page

**Files:**
- Create: `src/app/[locale]/(marketing)/newsletter/page.tsx`

- [ ] **Step 1: Implement the page** (reads `?status=` and renders one of three states in the marketing shell):

```tsx
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";

type Status = "confirmed" | "unsubscribed" | "invalid";
const KNOWN: Status[] = ["confirmed", "unsubscribed", "invalid"];

export default async function NewsletterStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const { status: raw } = await searchParams;
  const status: Status = KNOWN.includes(raw as Status) ? (raw as Status) : "invalid";
  const t = await getTranslations({ locale, namespace: "landing" });

  return (
    <LandingShell locale={locale} screenLabel="Newsletter">
      <header className="page-hero">
        <div className="wrap">
          <span className="eyebrow accent">{t("newsletter.statusEyebrow")}</span>
          <h1>{t(`newsletter.status_${status}_title`)}</h1>
          <p className="lead">{t(`newsletter.status_${status}_body`)}</p>
          <p style={{ marginTop: 24 }}>
            <Link href="/" className="btn">{t("newsletter.statusHome")}</Link>
          </p>
        </div>
      </header>
    </LandingShell>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS (will still fail i18n key lookups at runtime until Task 10 — that's expected; keys land in Task 10).

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/(marketing)/newsletter
git commit -m "feat(newsletter): status page (confirmed/unsubscribed/invalid)"
```

---

## Task 9: NewsletterSignup client component

**Files:**
- Create: `src/app/[locale]/(marketing)/_components/NewsletterSignup.tsx`

- [ ] **Step 1: Implement the component** (compact + full variants, inline feedback via `useActionState`):

```tsx
"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { subscribeNewsletter, type SubscribeState } from "@/lib/newsletter/subscribe";

const initial: SubscribeState = { status: "idle" };

export function NewsletterSignup({
  variant = "full",
  source,
}: {
  variant?: "full" | "compact";
  source: string;
}) {
  const t = useTranslations("landing");
  const locale = useLocale();
  const [state, action, pending] = useActionState(subscribeNewsletter, initial);

  if (state.status === "ok") {
    return <p className="newsletter-ok">{t("newsletter.success")}</p>;
  }

  return (
    <form action={action} className={`newsletter-form ${variant}`}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="source" value={source} />
      {/* Honeypot: visually hidden, must stay empty. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="newsletter-hp"
      />
      <label className="sr-only" htmlFor={`nl-${source}`}>{t("newsletter.placeholder")}</label>
      <input
        id={`nl-${source}`}
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder={t("newsletter.placeholder")}
      />
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? t("newsletter.sending") : t("newsletter.button")}
      </button>
      {state.status === "error" && (
        <p className="newsletter-err">{t("newsletter.error")}</p>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Add styles** to `src/app/[locale]/(marketing)/landing-styles.ts` (append inside the exported `STYLES` template string, before its closing backtick):

```css
.newsletter-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.newsletter-form.compact{max-width:420px}
.newsletter-form input[type=email]{flex:1;min-width:200px;padding:10px 12px;border:1px solid var(--ink-soft);border-radius:8px;font:inherit}
.newsletter-hp{position:absolute!important;left:-9999px;width:1px;height:1px;overflow:hidden}
.newsletter-ok{color:var(--accent,#0a7);font-weight:500}
.newsletter-err{color:#c0392b;flex-basis:100%;font-size:13px;margin:4px 0 0}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
```

> If `--accent` / `--ink-soft` are not defined in the stylesheet, use the literal fallbacks shown. Verify the variable names against the existing `STYLES` block and match whatever the file already uses.

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/(marketing)/_components/NewsletterSignup.tsx src/app/[locale]/(marketing)/landing-styles.ts
git commit -m "feat(newsletter): signup component (compact + full)"
```

---

## Task 10: i18n — newsletter namespace + register

**Files:**
- Create: `src/messages/landing/en/newsletter.json` (+ `no/da/sv/fi/de`)
- Modify: `src/i18n/request.ts`

- [ ] **Step 1: Register the namespace.** In `src/i18n/request.ts`, add `"newsletter"` and `"team"` to the `LANDING_SECTIONS` array (Task 12 uses `team`; add both now):

```ts
const LANDING_SECTIONS = [
  "hero", "why", "vs", "rule", "pubs", "catalog",
  "stats", "how", "obj", "endCta", "foot",
  "newsletter", "team",
] as const;
```

- [ ] **Step 2: Author English** `src/messages/landing/en/newsletter.json`:

```json
{
  "heading": "Not ready to talk yet?",
  "lead": "Get occasional, no-fluff notes on native advertising across our nine markets — new titles, format ideas, and what's working. Unsubscribe anytime.",
  "placeholder": "you@company.com",
  "button": "Keep me posted",
  "sending": "Sending…",
  "success": "Almost there — check your inbox to confirm.",
  "error": "That email doesn't look right. Mind checking it?",
  "footerHeading": "Stay in the loop",
  "statusEyebrow": "Newsletter",
  "status_confirmed_title": "You're in.",
  "status_confirmed_body": "Your subscription is confirmed. We'll be in touch when there's something worth your time.",
  "status_unsubscribed_title": "You're unsubscribed.",
  "status_unsubscribed_body": "You won't receive newsletter emails from us. No hard feelings — you can resubscribe anytime.",
  "status_invalid_title": "That link didn't work.",
  "status_invalid_body": "The link may have expired or already been used. Try subscribing again from any page.",
  "statusHome": "Back to home"
}
```

- [ ] **Step 3: Create translated copies.** Create `no/da/sv/fi/de` versions of `newsletter.json` with natural native copy (no literal calques — per the translation-quality rule). Translate every key; keep the same keys. Example `no`:

```json
{
  "heading": "Ikke klar for en prat ennå?",
  "lead": "Få korte, konkrete notater om native-annonsering i de ni markedene våre — nye titler, formatideer og hva som faktisk virker. Meld deg av når som helst.",
  "placeholder": "deg@selskap.no",
  "button": "Hold meg oppdatert",
  "sending": "Sender …",
  "success": "Nesten i mål — sjekk innboksen for å bekrefte.",
  "error": "Den e-posten ser ikke helt riktig ut. Kan du sjekke den?",
  "footerHeading": "Hold deg oppdatert",
  "statusEyebrow": "Nyhetsbrev",
  "status_confirmed_title": "Du er med.",
  "status_confirmed_body": "Abonnementet er bekreftet. Vi tar kontakt når vi har noe som er verdt tiden din.",
  "status_unsubscribed_title": "Du er avmeldt.",
  "status_unsubscribed_body": "Du får ikke flere nyhetsbrev fra oss. Du kan melde deg på igjen når som helst.",
  "status_invalid_title": "Lenken virket ikke.",
  "status_invalid_body": "Lenken kan ha utløpt eller allerede vært brukt. Prøv å melde deg på igjen fra en hvilken som helst side.",
  "statusHome": "Tilbake til forsiden"
}
```

(Author `da`, `sv`, `fi`, `de` equivalently with native-quality copy.)

- [ ] **Step 4: Verify the app boots and keys resolve**

Run: `pnpm build`
Expected: PASS — no "missing message" errors for the `newsletter` namespace.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/request.ts src/messages/landing/*/newsletter.json
git commit -m "feat(newsletter): i18n copy across six locales"
```

---

## Task 11: Wire newsletter into footer + homepage

**Files:**
- Modify: `src/app/landing-shell.tsx`
- Modify: `src/app/[locale]/(marketing)/page.tsx`

- [ ] **Step 1: Footer compact signup.** In `landing-shell.tsx`, import the component at the top:

```tsx
import { NewsletterSignup } from "@/app/[locale]/(marketing)/_components/NewsletterSignup";
```

Then inside the `<footer className="page-foot">`'s `<div className="wrap">`, add a block before `<div className="left">`:

```tsx
<div className="foot-newsletter">
  <div className="copy">{t("foot.newsletterHeading")}</div>
  <NewsletterSignup variant="compact" source="footer" />
</div>
```

- [ ] **Step 2: Add the footer heading key** to every `src/messages/landing/{locale}/foot.json`:

```json
"newsletterHeading": "Stay in the loop"
```

(translate per locale — `no`: "Hold deg oppdatert", etc.)

- [ ] **Step 3: Homepage full block.** In `page.tsx`, import:

```tsx
import { NewsletterSignup } from "./_components/NewsletterSignup";
```

Add a section immediately before the `{/* END CTA */}` section:

```tsx
{/* NEWSLETTER */}
<section className="section newsletter-block">
  <div className="wrap">
    <h2>{t("newsletter.heading")}</h2>
    <p className="lead">{t("newsletter.lead")}</p>
    <NewsletterSignup variant="full" source="home" />
  </div>
</section>
```

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/landing-shell.tsx src/app/[locale]/(marketing)/page.tsx src/messages/landing/*/foot.json
git commit -m "feat(newsletter): wire signup into footer + homepage"
```

---

## Task 12: Publisher proof strip

**Files:**
- Create: `src/lib/marketing/strip-publishers.ts`
- Create: `src/app/[locale]/(marketing)/_components/PublisherStrip.tsx`
- Modify: `src/messages/landing/{locale}/pubs.json` (add `stripLabel`)
- Modify: `src/app/[locale]/(marketing)/landing-styles.ts`
- Modify: `page.tsx`, `for-advertisers/page.tsx`, `for-agencies/page.tsx`

- [ ] **Step 1: Data helper**

```ts
import { prisma } from "@/lib/prisma";

export type StripPublisher = { id: string; name: string; logoUrl: string | null };

// Top publishers by title count — the same ordering the homepage grid uses,
// surfaced as a slim logo/name strip. Real publishers only.
export async function getStripPublishers(limit = 10): Promise<StripPublisher[]> {
  const rows = await prisma.publisher.findMany({
    where: { titles: { some: {} } },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      _count: { select: { titles: true } },
    },
  });
  return rows
    .sort((a, b) => b._count.titles - a._count.titles)
    .slice(0, limit)
    .map((p) => ({ id: p.id, name: p.name, logoUrl: p.logoUrl }));
}
```

- [ ] **Step 2: Component** (async server component; logo when present, else text chip):

```tsx
import { getTranslations } from "next-intl/server";
import { getStripPublishers } from "@/lib/marketing/strip-publishers";

export async function PublisherStrip({ locale }: { locale: string }) {
  const [t, publishers] = await Promise.all([
    getTranslations({ locale, namespace: "landing" }),
    getStripPublishers(),
  ]);
  if (publishers.length === 0) return null;

  return (
    <section className="pub-strip" aria-label={t("pubs.stripLabel")}>
      <div className="wrap">
        <div className="pub-strip-label">{t("pubs.stripLabel")}</div>
        <ul className="pub-strip-row" role="list">
          {publishers.map((p) => (
            <li key={p.id} role="listitem">
              {p.logoUrl ? (
                <img src={p.logoUrl} alt={p.name} className="pub-strip-logo" />
              ) : (
                <span className="pub-strip-chip">{p.name}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Add `stripLabel`** to every `src/messages/landing/{locale}/pubs.json`:

```json
"stripLabel": "Publishers in our network"
```

(translate — `no`: "Utgivere i nettverket vårt", etc.)

- [ ] **Step 4: Styles** — append to `STYLES` in `landing-styles.ts`:

```css
.pub-strip{padding:28px 0;border-top:1px solid var(--ink-soft);border-bottom:1px solid var(--ink-soft)}
.pub-strip-label{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:14px}
.pub-strip-row{display:flex;flex-wrap:wrap;gap:14px 22px;list-style:none;margin:0;padding:0;align-items:center}
.pub-strip-logo{height:26px;width:auto;opacity:.8}
.pub-strip-chip{font-weight:600;color:var(--ink-mute);font-size:15px}
```

- [ ] **Step 5: Wire into homepage** — in `page.tsx`, import `import { PublisherStrip } from "./_components/PublisherStrip";` and render `<PublisherStrip locale={locale} />` immediately after the `{/* WHY */}` section's closing tag (high on the page).

- [ ] **Step 6: Wire into for-advertisers + for-agencies** — import (path `../_components/PublisherStrip`) and render `<PublisherStrip locale={locale} />` once in the body of each page, after the hero. Confirm each page already destructures `locale` from params; if not, add it.

- [ ] **Step 7: Verify build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/marketing/strip-publishers.ts src/app/[locale]/(marketing)/_components/PublisherStrip.tsx src/messages/landing/*/pubs.json src/app/[locale]/(marketing)/landing-styles.ts src/app/[locale]/(marketing)/page.tsx src/app/[locale]/(marketing)/for-advertisers/page.tsx src/app/[locale]/(marketing)/for-agencies/page.tsx
git commit -m "feat(trust): publisher proof strip on home + solution pages"
```

---

## Task 13: Team faces on /contact

**Files:**
- Create: `src/app/[locale]/(marketing)/contact/desk-team.ts`
- Create: `src/app/[locale]/(marketing)/contact/_components/TeamRow.tsx`
- Modify: `src/messages/landing/{locale}/team.json`
- Modify: `src/app/[locale]/(marketing)/contact/page.tsx`
- Modify: `src/app/[locale]/(marketing)/landing-styles.ts`

- [ ] **Step 1: Team config** (the single fill-in point — user supplies real people/photos; ships empty-safe):

```ts
export type TeamMember = {
  name: string;
  role: string;
  /** Path under /public, e.g. "/team/jane.jpg". Omit for an initials avatar. */
  photo?: string;
  linkedin?: string;
  phone?: string;
};

// Populate with the real desk team. Empty array → TeamRow renders nothing.
export const DESK_TEAM: TeamMember[] = [];
```

- [ ] **Step 2: TeamRow component**

```tsx
import { getTranslations } from "next-intl/server";
import { DESK_TEAM } from "../desk-team";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export async function TeamRow({ locale }: { locale: string }) {
  if (DESK_TEAM.length === 0) return null;
  const t = await getTranslations({ locale, namespace: "landing" });

  return (
    <section className="section team-section">
      <div className="wrap">
        <h2>{t("team.heading")}</h2>
        <p className="lead">{t("team.lead")}</p>
        <div className="grid team-grid">
          {DESK_TEAM.map((m) => (
            <article className="card team-card" key={m.name}>
              {m.photo ? (
                <img src={m.photo} alt={m.name} className="team-photo" />
              ) : (
                <div className="team-avatar" aria-hidden="true">{initials(m.name)}</div>
              )}
              <h3>{m.name}</h3>
              <p className="muted">{m.role}</p>
              <p className="team-links">
                {m.linkedin && <a href={m.linkedin} rel="noopener noreferrer" target="_blank">LinkedIn</a>}
                {m.phone && <a href={`tel:${m.phone}`}>{m.phone}</a>}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: i18n** `src/messages/landing/en/team.json` (+ translations):

```json
{
  "heading": "Talk to the desk",
  "lead": "Real people who build your plan, brief the writers, and stay on it until it's live."
}
```

(`no`: heading "Snakk med teamet", lead "Ekte folk som bygger planen din, briefer skribentene og følger den helt til den er publisert." — and `da/sv/fi/de`.)

- [ ] **Step 4: Styles** — append to `STYLES`:

```css
.team-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px}
.team-photo,.team-avatar{width:72px;height:72px;border-radius:50%;object-fit:cover}
.team-avatar{display:flex;align-items:center;justify-content:center;background:var(--ink-soft);font-weight:600;font-size:22px;color:var(--ink-mute)}
.team-links{display:flex;gap:14px;margin-top:8px}
```

- [ ] **Step 5: Wire into contact page** — in `contact/page.tsx`, import `import { TeamRow } from "./_components/TeamRow";` and render `<TeamRow locale={locale} />` directly after the `</header>` (before the channels section). `locale` is already destructured there.

- [ ] **Step 6: Verify build**

Run: `pnpm build`
Expected: PASS (TeamRow renders nothing while `DESK_TEAM` is empty — no layout change yet).

- [ ] **Step 7: Commit**

```bash
git add src/app/[locale]/(marketing)/contact src/messages/landing/*/team.json src/app/[locale]/(marketing)/landing-styles.ts
git commit -m "feat(trust): team row on /contact (empty-safe until populated)"
```

---

## Task 14: Full verification

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS (fix any new warnings/errors in the touched files).

- [ ] **Step 3: Unit tests**

Run: `pnpm test`
Expected: PASS — validate (4), classify (5), email (1).

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: PASS — no missing-message errors across all six locales.

- [ ] **Step 5: Manual smoke (dev server on the project's configured port — never 3000)**

Run: `pnpm dev` then in a browser:
1. Submit the footer signup with a valid email → inline "check your inbox", `[email]` log line printed (console adapter in dev).
2. Submit with `notanemail` → inline error.
3. Copy the confirm URL from the logged email body / DB row, open `/api/newsletter/confirm?token=…` → redirects to `/{locale}/newsletter?status=confirmed`.
4. Open the unsubscribe URL → redirects to `?status=unsubscribed`.
5. Open `/api/newsletter/confirm?token=garbage` → `?status=invalid`.
6. Confirm the publisher strip shows real publisher names on `/`, `/for-advertisers`, `/for-agencies`.
7. Confirm `/contact` is unchanged (team row empty until populated).

- [ ] **Step 6: Final commit (if smoke fixes needed)**

```bash
git add -A
git commit -m "chore(trust-capture): verification fixes"
```

---

## Self-Review notes

- **Spec coverage:** newsletter model + double opt-in (T1, T5–T8) ✓; footer+home placement (T11) ✓; suppression honored (T6) ✓; generic-success no-disclosure (T3, T6) ✓; team faces empty-safe (T13) ✓; publisher strip with logo-or-text-chip + `logoUrl` field (T1, T12) ✓; third-party stat intentionally omitted ✓; i18n six locales (T10, T12, T13) ✓; tests for valid/invalid/duplicate/suppressed via pure cores (T2, T3) ✓; token confirm/unsubscribe valid+bad (T7 smoke + pure store) ✓; error handling friendly pages (T7, T8) ✓.
- **Known design choice:** raw unsub tokens are never stored; pre-confirmation emails use the confirm token for both links, and the unsubscribe route resolves either token. Durable per-send unsub tokens arrive with the actual newsletter-send sub-project (out of scope here). This is called out in T5/T6.
- **Convention match:** DB-glue is not unit-tested (no prisma-mock infra in repo); pure logic is, mirroring `quotes.test.ts`.
