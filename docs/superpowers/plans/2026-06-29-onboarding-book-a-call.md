# Onboarding + Book-a-Call (GetTalk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nudge new buyers to book a GetTalk help-call — as the final onboarding step and as a dismissible dashboard (catalog) banner that also auto-hides once they book.

**Architecture:** A single client component (`GetTalkBooking`) injects GetTalk's `embed.js`. The existing market+phone onboarding gains a final `/onboarding/call` screen (inline scheduler + Skip). The catalog renders a dismissible banner (popup button) for buyers who haven't dismissed/booked; dismissal persists via a new `User.bookingPromptDismissedAt` column, and the embed's `gettalk:booking:complete` DOM event triggers the same dismissal. GetTalk itself already supports the embed + API; Part A adds one recipe doc.

**Tech Stack:** Next.js App Router (RSC + server actions), next-intl, Prisma/Postgres, NextAuth (`auth()`), node:test (`tsx --test`), GetTalk `embed.js`.

## Global Constraints

- Tests use **node:test**, run via `tsx --test` — NOT Vitest/Jest. Test files end `.test.ts`. Integration tests end `.it.test.ts` (excluded from `npm test`).
- **Named exports** only; functional React components; `const` over `let`; early returns; TypeScript strict.
- i18n: author copy in **`en` first**, then translate to `no, da, sv, fi, de`. The locale-key parity test (`src/messages/*.json` non-landing keys) MUST stay green — every new key exists in all 6 locales.
- Server Components by default; `'use client'` only when needed. Translations: server = `getTranslations({ locale, namespace })`, client = `useTranslations(namespace)`.
- Server actions: `'use server'`, `redirect` from `next/navigation`, prisma from `@/lib/prisma`, session from `@/auth` (`auth()`), redirect-safety via `safeNext` (`@/lib/onboarding-gate`).
- `main` auto-deploys to prod on push; `prisma migrate deploy` runs on deploy. Never run a dev server on port 3000.
- GetTalk handle is read from `NEXT_PUBLIC_GETTALK_USERNAME` (client-readable). When unset, components render a `mailto:desk@nativespin.com` fallback — never throw.
- GetTalk embed: `https://gettalk.co/embed.js`, attrs `data-username`, `data-mode` (`inline`|`popup`), `data-container`, `data-text`; emits a `gettalk:booking:complete` DOM event on `document`.

---

### Task 1: Add `User.bookingPromptDismissedAt` column

**Files:**
- Modify: `prisma/schema.prisma` (User model)
- Migration: generated under `prisma/migrations/`

- [ ] **Step 1: Add the field to the User model**

In `prisma/schema.prisma`, inside `model User { ... }`, add:

```prisma
  bookingPromptDismissedAt DateTime?
```

- [ ] **Step 2: Create the migration**

Run: `npx prisma migrate dev --name add_booking_prompt_dismissed_at`
Expected: a new folder `prisma/migrations/<ts>_add_booking_prompt_dismissed_at/migration.sql` containing `ALTER TABLE "User" ADD COLUMN "bookingPromptDismissedAt" TIMESTAMP(3);`

> If `migrate dev` is blocked in this environment, create the migration SQL by hand under that path and run `npx prisma generate`. (See memory: migrate dev may be blocked; prod runs `migrate deploy` on push.)

- [ ] **Step 3: Regenerate client + typecheck**

Run: `npx prisma generate && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add User.bookingPromptDismissedAt for booking nudge"
```

---

### Task 2: `shouldShowBookingBanner` gate (pure function + test)

**Files:**
- Create: `src/lib/booking-prompt.ts`
- Test: `src/lib/booking-prompt.test.ts`

**Interfaces:**
- Produces: `shouldShowBookingBanner(input: { audience: string; dismissedAt: Date | null }): boolean` — true only for the `"advertiser"` or `"agency"` audience with `dismissedAt == null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/booking-prompt.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowBookingBanner } from "./booking-prompt";

test("shows for an advertiser who hasn't dismissed", () => {
  assert.equal(shouldShowBookingBanner({ audience: "advertiser", dismissedAt: null }), true);
});

test("shows for an agency who hasn't dismissed", () => {
  assert.equal(shouldShowBookingBanner({ audience: "agency", dismissedAt: null }), true);
});

test("hidden once dismissed", () => {
  assert.equal(shouldShowBookingBanner({ audience: "advertiser", dismissedAt: new Date() }), false);
});

test("hidden for non-buyer audiences (desk, publisher, public)", () => {
  for (const audience of ["desk", "superadmin", "publisher", "writer", "public"]) {
    assert.equal(shouldShowBookingBanner({ audience, dismissedAt: null }), false);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/booking-prompt.test.ts`
Expected: FAIL ("Cannot find module './booking-prompt'").

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/booking-prompt.ts`:

```ts
// Buyers (advertiser + agency audiences) who haven't dismissed/booked the
// help-call nudge see the catalog banner. Pure — keep DB/session out of here.
const BUYER_AUDIENCES = new Set(["advertiser", "agency"]);

export function shouldShowBookingBanner(input: {
  audience: string;
  dismissedAt: Date | null;
}): boolean {
  return BUYER_AUDIENCES.has(input.audience) && input.dismissedAt == null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/booking-prompt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/booking-prompt.ts src/lib/booking-prompt.test.ts
git commit -m "feat(catalog): booking-banner visibility gate"
```

---

### Task 3: `GetTalkBooking` component + fallback-href helper

**Files:**
- Create: `src/components/GetTalkBooking.tsx`
- Modify: `src/components/index.ts` (barrel — add export; confirm path with `rg "export" src/components/index.ts`)
- Test: `src/components/get-talk-booking.test.ts`

**Interfaces:**
- Produces: `resolveBookingFallbackHref(handle: string | undefined): string` — `https://gettalk.co/<handle>` when set, else `mailto:desk@nativespin.com`.
- Produces: `GetTalkBooking({ mode, text }: { mode: "inline" | "popup"; text?: string })` — client component.

- [ ] **Step 1: Write the failing test for the helper**

Create `src/components/get-talk-booking.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBookingFallbackHref } from "./GetTalkBooking";

test("falls back to the gettalk booking page when handle is set", () => {
  assert.equal(resolveBookingFallbackHref("admirate"), "https://gettalk.co/admirate");
});

test("falls back to desk email when handle is missing", () => {
  assert.equal(resolveBookingFallbackHref(undefined), "mailto:desk@nativespin.com");
  assert.equal(resolveBookingFallbackHref(""), "mailto:desk@nativespin.com");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/components/get-talk-booking.test.ts`
Expected: FAIL (module/export not found).

- [ ] **Step 3: Implement the component**

Create `src/components/GetTalkBooking.tsx`:

```tsx
"use client";

import { useEffect, useId, useRef } from "react";

const HANDLE = process.env.NEXT_PUBLIC_GETTALK_USERNAME;
const DESK_EMAIL = "desk@nativespin.com";

export function resolveBookingFallbackHref(handle: string | undefined): string {
  return handle ? `https://gettalk.co/${handle}` : `mailto:${DESK_EMAIL}`;
}

// Injects GetTalk's embed.js into a container we own. embed.js reads the
// script's data-* attributes and renders into data-container. We always also
// render a plain fallback link so booking is reachable even if the script is
// blocked (CSP/network) or the handle is unset.
export function GetTalkBooking({
  mode,
  text,
}: {
  mode: "inline" | "popup";
  text?: string;
}) {
  const rawId = useId();
  const containerId = `gettalk-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!HANDLE || !ref.current) return;
    const script = document.createElement("script");
    script.src = "https://gettalk.co/embed.js";
    script.async = true;
    script.setAttribute("data-username", HANDLE);
    script.setAttribute("data-mode", mode);
    script.setAttribute("data-container", containerId);
    if (text) script.setAttribute("data-text", text);
    document.body.appendChild(script);
    const container = ref.current;
    return () => {
      script.remove();
      if (container) container.innerHTML = "";
    };
  }, [mode, text, containerId]);

  const fallbackHref = resolveBookingFallbackHref(HANDLE || undefined);

  return (
    <div className="gettalk-booking">
      {HANDLE ? <div id={containerId} ref={ref} /> : null}
      <a
        href={fallbackHref}
        className={HANDLE ? "gettalk-booking-fallback" : "btn primary"}
        target={HANDLE ? "_blank" : undefined}
        rel="noreferrer"
      >
        {text ?? "Book a call"}
      </a>
    </div>
  );
}
```

> The component file exports the pure `resolveBookingFallbackHref` so node:test can import it without rendering React. The `"use client"` directive does not affect a direct `tsx --test` import of a named function.

- [ ] **Step 4: Add the barrel export**

In `src/components/index.ts` add:

```ts
export { GetTalkBooking, resolveBookingFallbackHref } from "./GetTalkBooking";
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx tsx --test src/components/get-talk-booking.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (2 tests) + tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/GetTalkBooking.tsx src/components/get-talk-booking.test.ts src/components/index.ts
git commit -m "feat(booking): GetTalkBooking embed component with fallback link"
```

---

### Task 4: `dismissBookingPrompt` server action

**Files:**
- Create: `src/app/booking-prompt-actions.ts`

**Interfaces:**
- Produces: `dismissBookingPrompt(): Promise<void>` — sets `bookingPromptDismissedAt = now()` for the current user; no-op when unauthenticated.

- [ ] **Step 1: Implement the action**

Create `src/app/booking-prompt-actions.ts`:

```ts
"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Persist that the buyer has dismissed (or completed) the help-call nudge, so
// it stays hidden across visits/devices. Idempotent; safe to call repeatedly.
export async function dismissBookingPrompt(): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return;
  await prisma.user.update({
    where: { id: userId },
    data: { bookingPromptDismissedAt: new Date() },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/booking-prompt-actions.ts
git commit -m "feat(booking): dismissBookingPrompt server action"
```

---

### Task 5: Copy keys (6 locales)

**Files:**
- Modify: `src/messages/en.json`, then `no.json`, `da.json`, `sv.json`, `fi.json`, `de.json`

**Interfaces:**
- Produces keys under `onboarding`: `callHeading`, `callBody`, `callSkip`.
- Produces keys under `catalog`: `bookCallTitle`, `bookCallBody`, `bookCallCta`, `bookCallDismiss`.

- [ ] **Step 1: Add the `en` keys**

In `src/messages/en.json`, add to the `onboarding` object:

```json
"callHeading": "One last thing — let's help you buy native",
"callBody": "Book a free 15-minute call and our desk will help you scope and place your first native campaign.",
"callSkip": "Skip for now →"
```

And to the `catalog` object:

```json
"bookCallTitle": "Want a hand buying native?",
"bookCallBody": "Book a free 15-minute call — our desk helps you scope, pick titles and place the campaign.",
"bookCallCta": "Book a call",
"bookCallDismiss": "Dismiss"
```

- [ ] **Step 2: Add the same keys to the 5 other locales**

Add to each of `no/da/sv/fi/de.json` (same key names, translated values). Norwegian example (`no.json`):

```json
"callHeading": "Én siste ting — la oss hjelpe deg å kjøpe native",
"callBody": "Book en gratis 15-minutters samtale, så hjelper desken deg å sette opp og plassere din første native-kampanje.",
"callSkip": "Hopp over nå →"
```

```json
"bookCallTitle": "Vil du ha hjelp til å kjøpe native?",
"bookCallBody": "Book en gratis 15-minutters samtale — desken hjelper deg å sette opp, velge titler og plassere kampanjen.",
"bookCallCta": "Book en samtale",
"bookCallDismiss": "Lukk"
```

(da/sv/fi/de: translate the same six strings. Keep them natural, not literal calques.)

- [ ] **Step 3: Validate JSON + run the parity test**

Run: `for f in src/messages/{en,no,da,sv,fi,de}.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))"; done && npm test 2>&1 | tail -8`
Expected: all JSON valid; suite green incl. "locale key parity".

- [ ] **Step 4: Commit**

```bash
git add src/messages
git commit -m "i18n(booking): onboarding + catalog book-a-call copy (6 locales)"
```

---

### Task 6: Onboarding final step `/onboarding/call`

**Files:**
- Create: `src/app/[locale]/onboarding/call/page.tsx`
- Modify: `src/app/onboarding-actions.ts` (redirect target after save)

**Interfaces:**
- Consumes: `GetTalkBooking` (Task 3), `onboarding.callHeading/callBody/callSkip` (Task 5), `safeNext` + `auth` + `prisma`.

- [ ] **Step 1: Point onboarding at the call step**

In `src/app/onboarding-actions.ts`, find where `saveOnboarding` redirects after a successful save (currently to the resolved `next`, default `/${locale}/catalog`). Change it to route through the call step, preserving `next`:

```ts
// after the user's market + phone are saved:
redirect(`/${locale}/onboarding/call?next=${encodeURIComponent(next)}`);
```

(Keep the existing `safeNext` resolution of `next` as-is; only the final redirect target changes.)

- [ ] **Step 2: Create the call step page**

Create `src/app/[locale]/onboarding/call/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { safeNext } from "@/lib/onboarding-gate";
import { LandingShell } from "@/app/landing-shell";
import { Link } from "@/i18n/navigation";
import { GetTalkBooking } from "@/components";

export const dynamic = "force-dynamic";

export default async function OnboardingCallPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  // Reachable only after onboarding proper (market + phone) is complete.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { phone: true, organization: { select: { marketCode: true } } },
  });
  if (!user?.organization?.marketCode || !user.phone) {
    redirect(`/${locale}/onboarding`);
  }

  const next = safeNext(
    typeof sp.next === "string" ? sp.next : undefined,
    `/${locale}/catalog`,
  );
  const t = await getTranslations({ locale, namespace: "onboarding" });

  return (
    <LandingShell locale={locale} screenLabel="Onboarding" withFooter={false}>
      <section className="onboarding-call wrap">
        <h1>{t("callHeading")}</h1>
        <p className="lead">{t("callBody")}</p>
        <GetTalkBooking mode="inline" />
        <p>
          <Link href={next}>{t("callSkip")}</Link>
        </p>
      </section>
    </LandingShell>
  );
}
```

> Confirm `LandingShell`'s prop names against `src/app/[locale]/onboarding/page.tsx` (the existing onboarding page uses it) and mirror them. `next` from `safeNext` is locale-prefixed, so use a plain anchor/`Link href={next}` consistent with how the existing onboarding page navigates to `next`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Manual verification (run the app, not on port 3000)**

Run the app on the project's configured port. Sign in as a buyer whose onboarding is incomplete, complete market+phone → expect to land on `/<locale>/onboarding/call` with the inline scheduler (or the fallback link if `NEXT_PUBLIC_GETTALK_USERNAME` is unset) and a working "Skip for now →" to `/catalog`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/onboarding/call/page.tsx" src/app/onboarding-actions.ts
git commit -m "feat(onboarding): book-a-call step after market+phone"
```

---

### Task 7: Dashboard banner on the catalog

**Files:**
- Create: `src/app/[locale]/catalog/_components/CatalogBookCallBanner.tsx`
- Modify: `src/app/[locale]/catalog/page.tsx` (compute eligibility + render banner)

**Interfaces:**
- Consumes: `shouldShowBookingBanner` (Task 2), `GetTalkBooking` (Task 3), `dismissBookingPrompt` (Task 4), `catalog.bookCall*` copy (Task 5), `audienceFor` (`@/lib/nav`).

- [ ] **Step 1: Build the banner client component**

Create `src/app/[locale]/catalog/_components/CatalogBookCallBanner.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { GetTalkBooking } from "@/components";
import { dismissBookingPrompt } from "@/app/booking-prompt-actions";

export function CatalogBookCallBanner() {
  const t = useTranslations("catalog");
  const [hidden, setHidden] = useState(false);

  const dismiss = () => {
    setHidden(true); // optimistic
    void dismissBookingPrompt();
  };

  // The embed fires this on a completed booking — treat it as a dismissal so
  // the nudge never returns once they've actually booked. No server webhook needed.
  useEffect(() => {
    const onBooked = () => dismiss();
    document.addEventListener("gettalk:booking:complete", onBooked);
    return () => document.removeEventListener("gettalk:booking:complete", onBooked);
  }, []);

  if (hidden) return null;

  return (
    <div className="book-call-banner" role="note">
      <div>
        <strong>{t("bookCallTitle")}</strong>
        <p className="muted">{t("bookCallBody")}</p>
      </div>
      <div className="book-call-banner-actions">
        <GetTalkBooking mode="popup" text={t("bookCallCta")} />
        <button type="button" className="book-call-banner-dismiss" aria-label={t("bookCallDismiss")} onClick={dismiss}>
          ×
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it in the catalog page for eligible buyers**

In `src/app/[locale]/catalog/page.tsx` (logged-in branch — after `const session = await auth();` and before the `return`), compute eligibility and render the banner just inside the returned `<section>`, above `<h1>`:

```tsx
// add imports at top
import { audienceFor } from "@/lib/nav";
import { shouldShowBookingBanner } from "@/lib/booking-prompt";
import { CatalogBookCallBanner } from "./_components/CatalogBookCallBanner";

// after session is loaded (user is guaranteed here):
const dismissedAt = (
  await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { bookingPromptDismissedAt: true },
  })
)?.bookingPromptDismissedAt ?? null;
const showBookingBanner = shouldShowBookingBanner({
  audience: audienceFor(session),
  dismissedAt,
});
```

```tsx
// inside the returned JSX, first child of <section>:
{showBookingBanner ? <CatalogBookCallBanner /> : null}
```

> If the catalog page already fetches the user, fold `bookingPromptDismissedAt` into that existing `select` instead of adding a second query (DRY — check before adding).

- [ ] **Step 3: Minimal styles**

Append to `src/app/globals.css`:

```css
.book-call-banner { display:flex; gap:16px; align-items:center; justify-content:space-between; margin:0 0 16px; padding:14px 18px; border:1px solid var(--line,#e3ddcd); border-radius:10px; background:var(--surface-2,#faf7ef); }
.book-call-banner p { margin:4px 0 0; font-size:0.9rem; }
.book-call-banner-actions { display:flex; align-items:center; gap:10px; }
.book-call-banner-dismiss { background:none; border:none; font-size:20px; line-height:1; cursor:pointer; color:var(--ink-mute,#5b5648); }
```

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit -p tsconfig.json && npm test 2>&1 | tail -8`
Expected: tsc exit 0; suite green.

- [ ] **Step 5: Manual verification**

As a buyer on `/catalog`: banner shows; clicking "Book a call" opens the GetTalk popup; "×" hides it and it stays hidden on reload (DB persisted). As desk/publisher: no banner.

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/catalog/_components/CatalogBookCallBanner.tsx" "src/app/[locale]/catalog/page.tsx" src/app/globals.css
git commit -m "feat(catalog): dismissible book-a-call banner (hides on booking)"
```

---

### Task 8: Document the env var

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the variable**

Append to `.env.example`:

```bash
# GetTalk booking handle for the help-call nudge (client-readable).
# Set to the desk's claimed gettalk.co handle, e.g. "admirate". Unset = mailto fallback.
NEXT_PUBLIC_GETTALK_USERNAME=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(env): document NEXT_PUBLIC_GETTALK_USERNAME"
```

---

### Task 9 (Part A — gettalk repo): "Embed booking in your app" recipe doc

**Repo:** `~/Projects/gettalk` (separate from NativeSpin). Docs-only, no runtime code.

**Files:**
- Create: `apps/web/src/app/(marketing)/docs/embed-in-your-app/page.tsx`
- Modify: `apps/web/src/app/(marketing)/docs/page.tsx` (add a link in the docs index)

- [ ] **Step 1: Read two existing docs pages for the exact pattern**

Read `apps/web/src/app/(marketing)/docs/embed/page.tsx` (+ `embed/embed-content.tsx`) and `docs/api/page.tsx` to match component structure, `CodeBlock` usage, layout wrapper, and metadata. Mirror them.

- [ ] **Step 2: Create the recipe page**

Create `apps/web/src/app/(marketing)/docs/embed-in-your-app/page.tsx` following the same structure as `docs/embed/page.tsx`, with these sections (use the shared `CodeBlock`/layout components the other docs pages use):

1. **Intro** — "Add a 'book a call' step to your product's onboarding and dashboard."
2. **Onboarding step (inline):**

```html
<script src="https://gettalk.co/embed.js"
  data-username="your-username" data-mode="inline" data-container="onboarding-call"></script>
<div id="onboarding-call"></div>
```

3. **Dashboard nudge (popup):**

```html
<script src="https://gettalk.co/embed.js"
  data-username="your-username" data-mode="popup" data-text="Book a call"></script>
```

4. **Hide the nudge once they book** — listen for the booking event:

```js
document.addEventListener('gettalk:booking:complete', (e) => {
  // mark the user as booked in your app so the nudge stops showing
  hideBookingNudge();
});
```

5. **Prefer the API?** — fetch availability + create the booking with an API key:

```bash
curl "https://gettalk.co/api/v1/availability?username=your-username" \
  -H "Authorization: Bearer gtk_your_api_key"

curl -X POST "https://gettalk.co/api/v1/bookings" \
  -H "Authorization: Bearer gtk_your_api_key" -H "Content-Type: application/json" \
  -d '{"startTime":"2026-07-01T09:00:00Z","endTime":"2026-07-01T09:15:00Z","timezone":"Europe/Oslo","attendeeName":"Jane","attendeeEmail":"jane@acme.com"}'
```

6. Link to `/docs/embed` (all attributes) and `/docs/api` (full reference).

- [ ] **Step 3: Link it from the docs index**

In `apps/web/src/app/(marketing)/docs/page.tsx`, add a link/card to `/docs/embed-in-your-app` ("Embed booking in your app") next to the existing Embed/API links. Match the existing markup.

- [ ] **Step 4: Verify + commit**

Run (in `~/Projects/gettalk`): `cd apps/web && pnpm db:generate && pnpm exec tsc --noEmit` → expect 0 errors (the `db:generate` is required for a clean local typecheck — see PR #1 notes).

```bash
git add "apps/web/src/app/(marketing)/docs/embed-in-your-app/page.tsx" "apps/web/src/app/(marketing)/docs/page.tsx"
git commit -m "docs(embed): recipe — book-a-call in your onboarding & dashboard"
```

---

## Notes for the executor

- Tasks 1–8 are NativeSpin (this repo); Task 9 is the gettalk repo. Do NOT push to `main` in either repo until the user approves — both auto-deploy. Use the branch → PR → merge flow per recent history (NativeSpin PRs #25–#27, gettalk PR #1).
- The handle (`NEXT_PUBLIC_GETTALK_USERNAME`) is a deploy-time config the user sets; the build/tests don't depend on its value (fallback covers unset).
