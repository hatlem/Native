# Trust & Capture — Design Spec

**Date:** 2026-05-30
**Status:** Approved (design); pending spec review
**Sub-project:** 1 of 5 in the SUNT-gap competitive build (see decomposition below)

## Context

A competitive audit of suntcontent.com surfaced trust/proof and lead-capture
elements NativeSpin's marketing lacks. The full gap was decomposed into five
sub-projects:

1. **Trust & capture** *(this spec)* — marketing-only, no false capability claims.
2. New formats (Native Plus / Content Video).
3. Targeting.
4. Optimization (conversion tracking + A/B).
5. Programmatic / DSP buying mode.

Sub-projects 2–5 introduce real product capabilities and are out of scope here.

This sub-project ships three things, none of which makes a capability claim the
product can't back up:

- A **newsletter / soft lead-capture** with double opt-in.
- **Real team faces** on `/contact`.
- A **publisher proof strip** (real publishers already in the catalog).

A third-party validation stat is **intentionally omitted** — we will not
fabricate a citable figure. The existing DB-computed stats stay as they are.

## Grounding (current state)

- **ESP:** Resend, transactional only, via the adapter in `src/lib/notify.ts`
  + `src/lib/mail/resend.ts`. No GetMailer send client, no list-subscribe.
- **Suppression:** `OutreachSuppression` (email PK) is written by the Resend
  bounce/complaint webhook (`src/lib/outreach/suppression.ts`,
  `src/lib/mail/resend-webhook.ts`). Honored here but not extended.
- **Token pattern:** SHA-256 hash at rest, raw token only in the URL — mirror
  `MagicLinkToken` / `PasswordResetToken`.
- **Marketing styling:** plain CSS classes against the existing stylesheet —
  **not Tailwind**. New components match this.
- **i18n:** per-namespace JSON under `src/messages/landing/{locale}/<ns>.json`,
  registered in `LANDING_SECTIONS` in `src/i18n/request.ts`; consumed via
  `getTranslations({ locale, namespace: "landing" })` then `t("ns.key")`.
  Locales: `en, no, da, sv, fi, de`. English authored first, then translated.
- **Publishers:** rendered as text + market flags; `Publisher` has **no** logo
  field and there are **no** logo assets in `public/`.
- **Server-action idiom:** FormData + `redirect()`. For the newsletter form we
  use a server action with `useActionState` for inline feedback (better UX for a
  public capture); input validated with zod.

## 1. Newsletter

### Data model (additive migration)

New `Subscriber` model:

| Field              | Type                         | Notes                                  |
|--------------------|------------------------------|----------------------------------------|
| `email`            | String `@id`                 | lowercased, trimmed                    |
| `locale`           | String                       | capture-time locale                    |
| `status`           | `SubscriberStatus`           | `PENDING \| CONFIRMED \| UNSUBSCRIBED` |
| `confirmTokenHash` | String?                      | SHA-256; cleared after confirm         |
| `unsubTokenHash`   | String                       | SHA-256; stable for life of the row    |
| `source`           | String                       | e.g. `footer`, `home`                  |
| `createdAt`        | DateTime `@default(now())`   |                                        |
| `confirmedAt`      | DateTime?                    |                                        |
| `unsubscribedAt`   | DateTime?                    |                                        |

New enum `SubscriberStatus { PENDING CONFIRMED UNSUBSCRIBED }`.
Index on `status`.

Migration is additive (new table + enum) — safe for the auto-migrate-on-deploy
flow.

### Flow (double opt-in)

1. `NewsletterSignup` client component (compact + full variants) posts to server
   action `subscribeNewsletter`.
   - Input: `email`, hidden honeypot field, `source`.
   - zod-validated email; honeypot non-empty → silent success (drop).
2. Action behavior:
   - If email is on `OutreachSuppression` **or** already `CONFIRMED` → return the
     **same generic success** message, send nothing (no info disclosure).
   - Else upsert a `PENDING` row, (re)issue `confirmTokenHash`, send a Resend
     confirmation email containing the tokenized confirm link and an unsubscribe
     link.
   - Re-subscribe of an `UNSUBSCRIBED` row → back to `PENDING` + new confirm send.
3. `GET /api/newsletter/confirm?token=…` → match by hash, set `CONFIRMED`,
   stamp `confirmedAt`, clear `confirmTokenHash`, render a confirmation page.
4. `GET /api/newsletter/unsubscribe?token=…` → set `UNSUBSCRIBED`, stamp
   `unsubscribedAt`, render a confirmation page. One-click, no login. Link
   present in every newsletter email.

Tokens: generated raw, stored hashed. Confirm token single-use; unsub token
long-lived (must keep working in old emails).

### Placement

- **Compact** variant in the shared marketing footer (`landing-shell.tsx`,
  `foot` namespace) — every marketing page.
- **Full** "not ready yet?" block at the end of the homepage, near `#request`.

## 2. Contact — team faces

- `TeamRow` component on `/contact`, rendered above the existing channel cards.
- Driven by a typed config `src/app/[locale]/(marketing)/contact/desk-team.ts`:
  `{ name: string; role: string; photo: string; linkedin?: string; phone?: string }[]`.
- Photos in `public/team/`. **Real data supplied by the user** is the single
  fill-in point; nothing fake ships. If the config is empty the row renders
  nothing (graceful).
- Initials/monogram fallback if a `photo` is missing.

## 3. Publisher proof strip

- Add nullable `Publisher.logoUrl String?` (additive migration).
- `PublisherStrip` component: renders `<img src={logoUrl}>` when present, else a
  styled wordmark/text chip of the real publisher name → truthful, zero assets,
  real logos drop in later with no code change.
- Source: real publishers, top-by-title-count (reuse the existing homepage
  query shape). Placed as a slim social-proof strip high on the homepage and
  reused on `/for-advertisers` and `/for-agencies`.

## 4. i18n

- New namespaces `newsletter` and `team` added to `LANDING_SECTIONS`.
- Author `en` first; translate to `no/da/sv/fi/de` per the translation-quality
  rules (no literal calques; natural native copy).
- Strings: signup heading/lead/placeholder/button/success/error; confirm page;
  unsubscribe page; team section heading; publisher-strip label.

## 5. Error handling

- Invalid email → inline field error.
- Duplicate / suppressed → generic success (no disclosure).
- Invalid / expired / already-used token → friendly page, never a 500.
- Resend send failure → action still returns success to the user (PENDING row
  persists); failure logged. Confirmation can be re-triggered by re-submitting.

## 6. Testing

- Vitest unit tests for `subscribeNewsletter`: valid, invalid email, honeypot
  trip, duplicate `CONFIRMED`, suppressed email, `UNSUBSCRIBED` re-subscribe.
- Tests for confirm + unsubscribe handlers: valid token, bad token, idempotent
  repeat.

## File touch list (anticipated)

- `prisma/schema.prisma` — `Subscriber` model, `SubscriberStatus` enum,
  `Publisher.logoUrl`.
- `src/lib/newsletter/` — subscribe action, token helpers, confirmation email.
- `src/app/api/newsletter/confirm/route.ts`, `.../unsubscribe/route.ts`.
- `src/app/.../_components/NewsletterSignup.tsx`, `PublisherStrip.tsx`,
  `contact/desk-team.ts`, `contact/_components/TeamRow.tsx`.
- `src/app/landing-shell.tsx` — footer capture.
- `src/app/[locale]/(marketing)/page.tsx` — home end block + strip.
- `src/app/[locale]/(marketing)/contact/page.tsx` — team row.
- `src/app/[locale]/(marketing)/for-advertisers/page.tsx`,
  `for-agencies/page.tsx` — strip reuse.
- `src/i18n/request.ts` + `src/messages/landing/{locale}/{newsletter,team}.json`.

## Out of scope

Targeting, new formats, programmatic, A/B / conversion tracking, and the
creative-prep guide — each a later sub-project with its own spec.
