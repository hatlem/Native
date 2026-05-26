# Magic Link Sign-In & Forgot Password — Design

**Status:** Draft for review
**Date:** 2026-05-26
**Author:** Andreas Hatlem (via Claude)

## Goal

Add passwordless sign-in via emailed magic link, plus a complete forgot-password flow. Wire up a real email provider (Resend) so all auth-related emails actually deliver. Keep the existing password sign-in working unchanged.

## Non-goals

- Email verification gate on signup (we trust the existing signup path)
- Signup via magic link (new accounts still go through `/signup` with org/market collection)
- 2FA, account lockout after N failed attempts, device fingerprinting
- A separate "change password" surface for signed-in users (out of scope; reset flow covers the primary need)
- Migrating off NextAuth JWT sessions

## Decisions taken during brainstorming

1. Magic link **coexists** with password sign-in (does not replace)
2. **Resend** is the email provider
3. **Click-the-link only** UX (no 6-digit codes)
4. Magic link is **sign-in only** — brand-new users still go through `/signup`
5. Extra emails: welcome on signup, password-changed notification, new-sign-in alert (on IP change)
6. **Custom token tables** (Approach A) mirroring the existing `PublisherInvite` pattern — not Auth.js's Email provider + PrismaAdapter

## Architecture overview

```
        ┌──────────────────────────────┐
        │  /[locale]/signin            │
        │  ┌────────────────────────┐  │
        │  │ password form          │──┼──▶ authenticate()  ─── existing
        │  └────────────────────────┘  │
        │  ┌────────────────────────┐  │
        │  │ magic-link form        │──┼──▶ requestMagicLink()
        │  └────────────────────────┘  │
        │  forgot password? ──────────┼──▶ /forgot-password
        └──────────────────────────────┘

  request action ──▶ insert MagicLinkToken/PasswordResetToken (hashed)
                ──▶ EmailAdapter (Resend in prod, console in dev)
                ──▶ /check-email (identical UX whether or not user existed)

  user clicks link in email
                ──▶ /[locale]/magic-link/[token]  (auto-consume + signIn + redirect)
                ──▶ /[locale]/reset-password/[token]  (form for new password)
```

## Data model

Two new Prisma models. Both store **SHA-256 hashes** of tokens — the raw token is only ever in the email URL and the user's browser, never on disk.

```prisma
model MagicLinkToken {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash   String   @unique
  expiresAt   DateTime
  consumedAt  DateTime?
  requestedIp String?
  createdAt   DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}

model PasswordResetToken {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash   String   @unique
  expiresAt   DateTime
  consumedAt  DateTime?
  requestedIp String?
  createdAt   DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}
```

Additions to `User`:

```prisma
model User {
  // ...existing fields
  emailVerifiedAt DateTime?  // set when first magic link is consumed; informational only
  lastSignInIp    String?    // for new-sign-in-alert mechanic
  lastSignInAt    DateTime?

  magicLinkTokens     MagicLinkToken[]
  passwordResetTokens PasswordResetToken[]
}
```

**TTL:** 15 minutes for both token types. Hard-coded constant in `src/lib/tokens.ts` — not configurable. (Configurable TTLs invite drift; one number, one place.)

**Cleanup:** `scripts/cleanup-auth-tokens.ts` deletes consumed/expired rows older than 30 days. Run on demand or via cron — not required for correctness, just for table hygiene.

## Token lifecycle

`src/lib/tokens.ts`:

```ts
const TOKEN_BYTES = 32;          // 256 bits of entropy
const TTL_MINUTES = 15;

export function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function tokenExpiry(): Date {
  return new Date(Date.now() + TTL_MINUTES * 60_000);
}
```

The raw token is sent in the **URL path** (not query string) so it does not leak into Referer headers or default access-log formats.

## Flows

### Magic-link sign-in

1. `POST` → `requestMagicLink(formData)` server action with `{ email, locale }`
2. Rate-limit on `magic-link:ip:<ip>` and `magic-link:email:<email>` (existing `authLimiter`)
3. Look up user by email. **Regardless of result**, redirect to `/[locale]/check-email`.
4. If user exists:
   - `raw = generateToken()`
   - Insert `MagicLinkToken { userId, tokenHash: hashToken(raw), expiresAt: tokenExpiry(), requestedIp }`
   - Send magic-link email with `${AUTH_URL}/${locale}/magic-link/${raw}`
   - `recordAudit(userId, "auth.magic_link_requested", …)`
5. User clicks link → `/[locale]/magic-link/[token]/page.tsx`. The page is a thin server-component wrapper around `signIn("magic-link", { token, redirect: false })`. **The Credentials provider owns the consume** — it is the single point that verifies + marks `consumedAt` in one transaction. The page only handles success/error rendering. Flow:
   - Read `token` from the path
   - Call `signIn("magic-link", { token, redirect: false })`
   - On error (token not found / already consumed / expired): render "this link has expired or was already used" + CTA back to `/signin`
   - On success: the provider's `authorize` already marked the token consumed, set `emailVerifiedAt` if null, and recorded the audit log. The page then:
     - Fires new-sign-in-alert email if `user.lastSignInIp` is set and differs from current IP
     - Updates `user.lastSignInIp` and `user.lastSignInAt`
     - `redirect(landingForRole(user.role, locale))`

### Password reset

1. `POST` → `requestPasswordReset({ email, locale })`
2. Rate-limit on `reset:ip:<ip>` and `reset:email:<email>`
3. Lookup; redirect to `/[locale]/check-email` either way
4. If user exists and `user.passwordHash != null` (only password users have a password to reset; passwordless-future-users would be told via the same generic page):
   - Insert `PasswordResetToken`, send email with `${AUTH_URL}/${locale}/reset-password/${raw}`
5. User opens reset link → `/[locale]/reset-password/[token]/page.tsx`:
   - Server component validates token (hash, not consumed, not expired) and renders the new-password form. Token is in the form as a hidden input.
   - Invalid token → render "this link has expired or was already used"
6. `POST` → `resetPassword(formData)` with `{ token, newPassword, locale }`:
   - Rate-limit on `reset-consume:ip:<ip>`
   - Validate `newPassword.length >= 8` (matches signup)
   - `passwordHash = bcrypt.hash(newPassword, 10)`
   - Inside one transaction:
     - `updateMany` the matching token (`where: tokenHash + consumedAt: null + expiresAt > now`). If `count !== 1`, abort with "this link has expired or was already used".
     - Load the token row to get `userId`.
     - Update `user.passwordHash`.
     - Mark **all other un-consumed** `PasswordResetToken` rows for this user as consumed (defense against leaked-token replay).
   - Fire `password-changed` email
   - `signIn("credentials", { email, password: newPassword, redirect: false })`
   - `redirect(landingForRole(user.role, locale))`

### New-sign-in alert

Shared helper `recordSignIn(userId, ip)` in `src/lib/auth-events.ts`. Called from `authenticate()` after credentials sign-in and from the magic-link page after `signIn("magic-link", …)`. Logic:

```
if user.lastSignInIp is null:
  # first sign-in ever; just record, no alert
else if user.lastSignInIp != current_ip:
  send new-sign-in-alert email (contains IP, timestamp, "reset password" link)
update user.lastSignInIp = current_ip
update user.lastSignInAt = now()
```

The alert is best-effort and runs after the session is issued; an email failure is logged but does not block sign-in. We do NOT call this from inside the magic-link Credentials provider's `authorize` because `headers()` is not reliably available there — we call it from the page/server action that owns the request context.

## Email layer

### Adapter

Extend `EmailMessage` in `src/lib/notify.ts` from `{to, subject, text}` to `{to, subject, text, html?}` — additive, existing callers unaffected.

`src/lib/mail/resend.ts`:

```ts
import { Resend } from "resend";
import type { EmailAdapter } from "@/lib/notify";

export function makeResendAdapter(): EmailAdapter | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const client = new Resend(key);
  const from = process.env.AUTH_EMAIL_FROM ?? "ATNative <noreply@atnative.com>";
  const replyTo = process.env.AUTH_EMAIL_REPLY_TO;
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

`src/lib/mail/index.ts` (imported once from `src/auth.ts` so it runs on every server start):

```ts
import { setEmailAdapter } from "@/lib/notify";
import { makeResendAdapter } from "./resend";

const adapter = makeResendAdapter();
if (adapter) setEmailAdapter(adapter);
// else: default console adapter from notify.ts remains — boot still succeeds without RESEND_API_KEY
```

### Templates

`src/lib/mail/templates/` — one file per email, each exporting a function `(args) => { subject, text, html }`:

- `magic-link.ts`
- `password-reset.ts`
- `welcome.ts`
- `password-changed.ts`
- `new-signin-alert.ts`
- `layout.ts` — shared HTML shell (inline styles, single CTA button, footer with reply-to note)
- `strings.ts` — locale-keyed copy for all five emails × five locales (en/no/da/de/fi)

No template engine. Plain TS strings + `layout()` helper. Inline styles only — Outlook compatibility.

### Env vars (added to `.env.example`)

```
RESEND_API_KEY=
AUTH_EMAIL_FROM="ATNative <noreply@atnative.com>"
AUTH_EMAIL_REPLY_TO=
```

`AUTH_URL` is already used by NextAuth — we reuse it when constructing email URLs so a Host-header attack cannot redirect the link.

## NextAuth changes (`src/auth.ts`)

Add a second `Credentials` provider, id `"magic-link"`. **This provider owns the token consume.** The page that triggers it is just a wrapper.

```ts
Credentials({
  id: "magic-link",
  credentials: {
    token: { label: "Token", type: "text" },
  },
  authorize: async (credentials) => {
    const raw = String(credentials?.token ?? "");
    if (!raw) return null;

    // Rate-limit consume by IP — guards against brute-forcing tokens
    // through repeated calls to /api/auth/callback/magic-link.
    const ip = await authClientIp();
    if (!(await authLimiter.check(`magic-consume:ip:${ip}`)).ok) return null;

    const hash = hashToken(raw);

    // Single transaction: re-check unused + mark consumed atomically.
    // updateMany with a guard clause wins double-click races (only one
    // call sees count===1; the other sees count===0).
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.magicLinkToken.updateMany({
        where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (updated.count !== 1) return null;
      const row = await tx.magicLinkToken.findUnique({
        where: { tokenHash: hash },
        include: { user: { include: { organization: { select: { id: true, type: true } } } } },
      });
      if (!row) return null;
      if (!row.user.emailVerifiedAt) {
        await tx.user.update({
          where: { id: row.userId },
          data: { emailVerifiedAt: new Date() },
        });
      }
      return row;
    });

    if (!result) return null;
    return {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name ?? undefined,
      role: result.user.role,
      orgId: result.user.organization?.id ?? null,
      orgType: result.user.organization?.type ?? null,
    };
  },
})
```

JWT session strategy stays. JWT/session callbacks unchanged.

`src/auth.ts` also gains a one-line import of `@/lib/mail` so the Resend adapter is installed at boot.

## Routes and pages

### Modified

- `src/app/[locale]/(marketing)/signin/page.tsx`
  - Keep existing password form
  - Add divider + second `<form action={requestMagicLink}>` with one email input + "Send sign-in link" button
  - Add `<Link href="/forgot-password">Forgot password?</Link>` under password form

### New

| Route | File | Purpose |
|---|---|---|
| `/[locale]/forgot-password` | `src/app/[locale]/(marketing)/forgot-password/page.tsx` | Email form → `requestPasswordReset` |
| `/[locale]/reset-password/[token]` | `src/app/[locale]/(marketing)/reset-password/[token]/page.tsx` | Validates token, renders new-password form |
| `/[locale]/magic-link/[token]` | `src/app/[locale]/magic-link/[token]/page.tsx` | Consumes token, signs in, redirects |
| `/[locale]/check-email` | `src/app/[locale]/(marketing)/check-email/page.tsx` | "Check your inbox. The link expires in 15 minutes." |

All new pages are server components. No client islands required.

### Server actions (`src/app/auth-actions.ts`)

New:

- `requestMagicLink(formData)`
- `requestPasswordReset(formData)`
- `resetPassword(formData)`
- (Magic-link consume happens via `signIn("magic-link", …)` inside the page — no separate exported action.)

Modified:

- `register(formData)` — after successful create + sign-in, fire the **welcome** email. Failure to send is logged, not surfaced.
- `authenticate(formData)` — after successful sign-in, call `recordSignIn(userId, ip)` (which fires the new-sign-in alert when IP changes).

### Middleware

`src/middleware.ts` — add the four new public routes to the allow list so they don't bounce to `/signin`.

### i18n

Extend `src/messages/<locale>/auth.json` (namespace already exists) with new keys for:

- `magicLink.cta`, `magicLink.divider`, `magicLink.button`, `magicLink.note`, `magicLink.consuming`, `magicLink.expired`
- `forgot.title`, `forgot.lead`, `forgot.button`
- `reset.title`, `reset.button`, `reset.success`, `reset.expired`
- `check.title`, `check.lead`

All five supported locales.

## Security

| Concern | Mitigation |
|---|---|
| Token leak via Referer | Token in URL path, not query. `Referrer-Policy: no-referrer` on token routes via Next route segment config. |
| Token leak via DB compromise | Only `tokenHash` (SHA-256) stored; raw token never persisted. |
| Token replay | Single-use enforced via `updateMany({ where: { consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } })` — only one of two concurrent callers sees `count === 1`. |
| Token guessing | 256-bit entropy (`crypto.randomBytes(32)`). DB lookup is by exact hash; no timing-attack surface. |
| Reset token replay after a successful reset | `resetPassword` transaction also invalidates all other un-consumed reset tokens for the same user. |
| Account enumeration | Both request actions redirect to `/check-email` regardless of whether the email is registered. Audit logs distinguish the cases internally but the user-facing response does not. |
| CSRF on request actions | Server Actions ship with origin + same-site cookie protection. |
| CSRF on token consume | Magic-link consume requires the secret token, which an attacker site cannot guess. Reset consume is a POST form requiring the token in the form body. |
| Host-header redirect to attacker domain | Email URLs are built from `process.env.AUTH_URL`, not request headers. |
| Email-delivery failure mid-sign-in | Auth completes; email failure is logged via `console.error("notify.email_failed", …)` (existing pattern). |
| Stale tokens accumulating | `scripts/cleanup-auth-tokens.ts`; not required for correctness. |

## Rate limits

Re-uses existing `authLimiter` in `src/lib/rate-limit.ts`.

| Action | Keys |
|---|---|
| `requestMagicLink` | `magic-link:ip:<ip>` + `magic-link:email:<email>` |
| `requestPasswordReset` | `reset:ip:<ip>` + `reset:email:<email>` |
| `resetPassword` (consume) | `reset-consume:ip:<ip>` |
| Magic-link page consume | `magic-consume:ip:<ip>` |

## Audit log

New event names (using existing `recordAudit`):

- `auth.magic_link_requested`
- `auth.magic_link_consumed`
- `auth.magic_link_invalid` (with reason: `not_found` / `consumed` / `expired`)
- `auth.password_reset_requested`
- `auth.password_reset_consumed`
- `auth.password_reset_invalid` (with reason)
- `auth.new_signin_alert` (with `oldIp`, `newIp`)

## Testing

### Unit (`tsx --test`)

- `src/lib/tokens.test.ts` — `generateToken` entropy/uniqueness, `hashToken` determinism
- `src/lib/mail/templates/*.test.ts` — one per template; snapshot `{ subject, text, html }` per locale; verify URL appears in text body
- `src/lib/mail/resend.test.ts` — `makeResendAdapter()` returns `null` without env; with env, mocks `Resend.send` and asserts call shape

### Integration (real test DB, mocked email adapter)

`src/app/auth-actions.test.ts`:

- `requestMagicLink` existing user — row inserted with correct hash + TTL; email sent; URL contains raw token
- `requestMagicLink` unknown email — no row, no email, still redirects to `/check-email`
- `requestMagicLink` rate-limited — redirects with `?error=rate`
- Magic-link consume happy path — single-use enforced; `emailVerifiedAt` set first time only
- Magic-link consume expired — rejects
- Magic-link consume race — `Promise.all` of two consumes, exactly one wins
- `requestPasswordReset` flows mirror the magic-link tests
- `resetPassword` happy path — password updated; this token consumed; all other open reset tokens for the user marked consumed; `password-changed` email sent
- `resetPassword` invalid token — rejects, no password change
- New-signin alert — fires when IP changes, silent when same; never blocks sign-in on email failure

### Manual E2E checklist

`docs/testing/auth-flows.md` — short checklist for human pass per release covering all five emails in real Resend.

## Out-of-scope follow-ups (deliberately deferred)

- Account lockout after N invalid consume attempts
- "Change password" UI for signed-in users
- Re-using `magicLinkToken` for re-authentication step-up (sensitive actions)
- User-agent fingerprinting on new-signin alert
- Email verification gate on signup
