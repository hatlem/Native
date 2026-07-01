# Onboarding + book-a-call (GetTalk) — design

**Date:** 2026-06-29
**Status:** Approved (design), pending implementation plan

## Problem & goal

Buying native advertising is high-touch — most new buyers need a human to help
scope and place a campaign. After a buyer signs up, we want to actively get them
to **book a help-call** (via our own GetTalk scheduler) rather than leaving them
to wander the catalog alone.

The nudge appears at two moments:
1. As the **final step of onboarding** (highest intent — they're already in the flow).
2. As a **dismissible banner on the dashboard** (`/catalog`) for anyone who skipped
   it or returns without having acted.

## Current state (what we build on)

- **Onboarding** (`src/app/[locale]/onboarding/page.tsx` + `src/app/onboarding-actions.ts`):
  a single form collecting billing **market** + **phone**. `saveOnboarding` saves them
  and `redirect`s to `next` (default `/{locale}/catalog`). A layout gate
  (`src/lib/onboarding-gate.ts`) forces new users (org.marketCode IS NULL) here.
- **Dashboard = `/catalog`** for buyers (`landingForRole` → `/{locale}/catalog`).
  Logged-in branch of `src/app/[locale]/catalog/page.tsx` renders filters + results.
- **No booking/scheduling integration exists.** GetTalk (`gettalk.co`) is our own
  scheduler; it exposes an embed script (`https://gettalk.co/embed.js`) with
  `data-username`, `data-mode` (`inline` | `popup` | `button`), `data-text`,
  `data-color`.

## Scope — two parts

This is a coupled two-codebase effort:

- **Part A — GetTalk (product; benefits ALL GetTalk users):** make sure any GetTalk
  customer can embed booking into their own onboarding/dashboard, via the widget OR
  the API, and can learn how. Audit (2026-06-29) found GetTalk **already** ships the
  capability; the work is one real fix (done) + one docs addition.
- **Part B — NativeSpin (consumer):** use GetTalk to add the onboarding step +
  dashboard booking nudge.

Part A unblocks Part B (NativeSpin needs a claimable handle + a documented embed).

## Part A — GetTalk product

**Already exists (verified in the gettalk codebase, no work needed):**
- `public/embed.js` v2 — `data-mode` inline | popup | button, `data-container`,
  `data-event/text/color`, `GetTalk.open()/close()`, and a
  **`gettalk:booking:complete`** DOM event the host page can listen for.
- REST API v1 — `POST /api/v1/bookings` (create), `GET /api/v1/availability`,
  `event-types`; `gtk_` API-key auth via `Authorization: Bearer`, scopes
  (`read:bookings`, `write:bookings`, …), conflict detection.
- API-key management UI (`/dashboard/api`) and docs (`/docs/embed`, `/docs/api`,
  `/docs/webhooks`) that already document modes, the booking-complete event, and the
  Bearer-key API with curl examples.

**Done (shipped, gettalk PR #1):** username/booking-handle registration was rejecting
all valid handles (`isFakeName` fuzzy-matched e.g. `admirate`→`admin`). Replaced with
exact-match `isReservedUsername`. This was the real blocker preventing *any* user from
setting up their booking link.

**New (the only remaining Part-A work): an end-to-end integration recipe doc.**
Add a `/docs/embed-in-your-app` (or a section in `/docs/embed`) guide that ties the
scattered pieces into the concrete pattern this project uses, so other users
"understand how to do it":
1. Inline booking as an onboarding step (`data-mode="inline"` + a Skip link).
2. A dashboard "Book a call" nudge (`data-mode="popup"`).
3. Hide the nudge once booked by listening for `gettalk:booking:complete`.
4. The API alternative (fetch `/availability`, `POST /bookings` with a `gtk_` key).
Link it from the `/docs` index. Copy/code only — no new runtime code.

## Non-goals (v1 / YAGNI)

- No GetTalk **server-side webhook** integration in NativeSpin. The client
  `gettalk:booking:complete` event is enough to hide the nudge (see Part B).
- No change to what onboarding collects (market + phone stay as-is).
- No booking logic built in NativeSpin — GetTalk owns scheduling entirely.
- No rebuild of GetTalk's embed/API — they already do the job.

## Part B — NativeSpin components

### 1. `GetTalkBooking` (client component, `src/components`)
Single component that loads `gettalk.co/embed.js` once and renders the GetTalk
widget. Props:
- `mode: "inline" | "popup"`
- `text?: string` (button label for popup mode)
The GetTalk handle comes from `process.env.NEXT_PUBLIC_GETTALK_USERNAME`
(example: `admirate`). Behaviour:
- Renders the documented `<script src=".../embed.js" data-username data-mode ...>`.
- **Fallback:** if the env handle is missing OR the script fails to load within a
  short timeout, render a plain anchor to `https://gettalk.co/<handle>` (or, if no
  handle, a `mailto:desk@nativespin.com`) so booking is always reachable.
- Named export, functional component, `"use client"`.

### 2. Onboarding final step — `/onboarding/call`
- New route `src/app/[locale]/onboarding/call/page.tsx`.
- `saveOnboarding` (onboarding-actions.ts) changes its post-save redirect from
  `next` → `/{locale}/onboarding/call?next=<encoded next>`.
- The screen: heading + short value line, **`GetTalkBooking mode="inline"`**, and a
  **"Skip for now →"** link that goes to `next` (default `/catalog`). Uses
  `LandingShell` like the existing onboarding page.
- Guard: if the user has no session → `/signin`; if onboarding isn't actually
  complete (no marketCode/phone) → back to `/onboarding`. This keeps the step
  reachable only post-onboarding.

### 3. Dashboard banner — catalog
- New `CatalogBookCallBanner` client component, rendered near the top of the
  logged-in branch of `catalog/page.tsx`.
- Shown only when: buyer audience AND `user.bookingPromptDismissedAt` is null.
- Contains copy + **`GetTalkBooking mode="popup"`** ("Book a call") and a dismiss
  "×" that calls a server action `dismissBookingPrompt` setting
  `User.bookingPromptDismissedAt = now()`. After dismiss it disappears (optimistic
  hide + server persist), and won't return on future visits.
- **Hide on booked:** the banner listens for the `gettalk:booking:complete` DOM event
  (emitted by embed.js when the user completes a booking) and calls the same
  `dismissBookingPrompt` action — so booking from the popup also permanently hides the
  nudge, no manual dismiss needed. (This is why no server webhook is required.)

### 4. Data — `User.bookingPromptDismissedAt`
- New nullable column `bookingPromptDismissedAt DateTime?` on `User` (Prisma).
- Migration via `prisma migrate` (runs on deploy). No backfill needed (null = not
  dismissed = show).

## Data flow

```
signup → /onboarding (market+phone) → saveOnboarding()
      → /onboarding/call  ──(Book via GetTalk inline)──> GetTalk handles scheduling
                          └─(Skip)──────────────────────> /catalog
/catalog (buyer, not dismissed) → banner with GetTalk popup
                                → dismiss → server action sets dismissedAt → hidden
```

## Configuration

- `NEXT_PUBLIC_GETTALK_USERNAME` — the desk's GetTalk handle (example `admirate`).
  Added to `.env.example`. Client-readable (NEXT_PUBLIC) since the embed runs in the
  browser. When unset, components render the mailto fallback (no hard failure).

## Error handling

- Missing/blocked embed script → fallback link (component never throws, page never breaks).
- `dismissBookingPrompt` failure → banner still hides optimistically for the session;
  next load re-shows it (acceptable — no data loss, just one more impression).
- `/onboarding/call` reached without completed onboarding → redirect to `/onboarding`.

## i18n

New copy authored in `en` first, then translated to `no/da/sv/fi/de`:
- `onboarding.callHeading`, `onboarding.callBody`, `onboarding.callSkip`
- `catalog.bookCallTitle`, `catalog.bookCallBody`, `catalog.bookCallCta`, `catalog.bookCallDismiss`
Locale-key parity test must stay green (all non-landing keys present in every locale).

## Testing

- node:test unit for the banner gate: `shouldShowBookingBanner({ audience, dismissedAt })`
  → true only for buyers with null `dismissedAt`. (Pure function, no DB.)
- Locale-key parity test covers the new copy keys across 6 locales.
- `GetTalkBooking` fallback logic (no handle → mailto) covered by a small unit on the
  href-resolver helper.

## Files touched (anticipated)

**Part A — gettalk repo (`~/Projects/gettalk`)**
- DONE: `apps/web/src/lib/signup-security.ts`, `api/username/check/route.ts`,
  `api/onboarding/route.ts` (username fix, PR #1).
- NEW: `apps/web/src/app/(marketing)/docs/embed-in-your-app/page.tsx` (recipe guide)
  + link from the `/docs` index. Docs-only.

**Part B — NativeSpin repo (this repo)**
- `prisma/schema.prisma` (+ migration) — `User.bookingPromptDismissedAt`
- `src/components/GetTalkBooking.tsx` (new) + barrel export
- `src/app/[locale]/onboarding/call/page.tsx` (new)
- `src/app/onboarding-actions.ts` — redirect to `/onboarding/call`
- `src/app/[locale]/catalog/page.tsx` — render banner for eligible buyers
- `src/app/[locale]/catalog/_components/CatalogBookCallBanner.tsx` (new)
- `src/app/.../*-actions.ts` — `dismissBookingPrompt` server action
- `src/messages/{en,no,da,sv,fi,de}.json` — new copy
- `.env.example` — `NEXT_PUBLIC_GETTALK_USERNAME`
- small unit tests (banner gate, fallback helper)
