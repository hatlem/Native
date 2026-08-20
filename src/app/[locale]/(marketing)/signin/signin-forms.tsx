"use client";

import { authenticate, requestMagicLink } from "@/app/auth-actions";
import { SubmitButton } from "@/components";

// Both forms below wrap the server action instead of passing it straight to
// `action={...}`: the actions now return `{ redirectTo }` and we navigate
// with `window.location.href` rather than letting Next's client router
// transition to the result. That soft navigation is the same "router state
// header could not be parsed" failure documented in programme-actions.ts /
// CatalogSort.tsx — here it left real sign-ins hanging on /check-email. A
// full navigation avoids it and matches how a bookmark/reload reaches the
// same page.

export function PasswordSignInForm({
  locale,
  initialEmail,
  labels,
}: {
  locale: string;
  initialEmail: string;
  labels: { email: string; password: string; submit: string; signingIn: string };
}) {
  async function action(formData: FormData) {
    const { redirectTo } = await authenticate(formData);
    window.location.href = redirectTo;
  }

  return (
    <form action={action} noValidate>
      <input type="hidden" name="locale" value={locale} />
      <div className="field">
        <label htmlFor="email">{labels.email}</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          defaultValue={initialEmail}
        />
      </div>
      <div className="field">
        <label htmlFor="password">{labels.password}</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <div className="actions">
        <SubmitButton label={labels.submit} pendingLabel={labels.signingIn} />
      </div>
    </form>
  );
}

export function MagicLinkForm({
  locale,
  labels,
}: {
  locale: string;
  labels: { email: string; button: string; sending: string };
}) {
  async function action(formData: FormData) {
    const { redirectTo } = await requestMagicLink(formData);
    window.location.href = redirectTo;
  }

  return (
    <form action={action} noValidate>
      <input type="hidden" name="locale" value={locale} />
      <div className="field">
        <label htmlFor="magic-email">{labels.email}</label>
        <input id="magic-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="actions">
        <SubmitButton label={labels.button} pendingLabel={labels.sending} className="btn primary block" />
      </div>
    </form>
  );
}
