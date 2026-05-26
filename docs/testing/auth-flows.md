# Manual E2E checklist — auth flows

Run this checklist before shipping a release that touches auth.

## Setup

1. Set `RESEND_API_KEY` to a real Resend test key (or use a Resend dashboard with "test mode" enabled).
2. Set `AUTH_EMAIL_FROM` to an address Resend will accept for your verified domain.
3. Have a seeded test user — e.g. `buyer@atnative.com`.

## Magic link sign-in

- [ ] Visit `/en/signin`, scroll to the magic-link form
- [ ] Enter `buyer@atnative.com`, click "Send sign-in link"
- [ ] Redirected to `/en/check-email`
- [ ] Check the Resend dashboard — one delivery to `buyer@atnative.com`
- [ ] Click the link in the email → land on `/en/catalog` (or the seeded user's landing page)
- [ ] Reload the same link → "this sign-in link has expired" page renders
- [ ] Repeat with an UNKNOWN email — still redirects to `/en/check-email`, NO email is sent

## Password reset

- [ ] Visit `/en/signin`, click "Forgot password?"
- [ ] Enter `buyer@atnative.com`, submit
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
