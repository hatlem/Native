"use client";

import { completeMfaSignIn, cancelMfaSignIn } from "@/app/mfa-actions";
import { SubmitButton } from "@/components";

// Second sign-in step. Same navigation pattern as the first step's forms
// (signin-forms.tsx): the action returns the destination and we do a full
// navigation, so the freshly-set session cookie is read by a clean request.
export function MfaSignInForm({
  locale,
  hasError,
  labels,
}: {
  locale: string;
  hasError: boolean;
  labels: { code: string; hint: string; submit: string; verifying: string; cancel: string };
}) {
  async function action(formData: FormData) {
    const { redirectTo } = await completeMfaSignIn(formData);
    window.location.href = redirectTo;
  }

  return (
    <>
      <form action={action} noValidate>
        <input type="hidden" name="locale" value={locale} />
        <div className="field">
          <label htmlFor="mfa-code">{labels.code}</label>
          <input
            id="mfa-code"
            name="code"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
            maxLength={24}
            aria-describedby="mfa-code-hint"
            aria-invalid={hasError || undefined}
          />
          <span className="hint" id="mfa-code-hint">
            {labels.hint}
          </span>
        </div>
        <div className="actions">
          <SubmitButton label={labels.submit} pendingLabel={labels.verifying} />
        </div>
      </form>
      <form action={cancelMfaSignIn} className="alt" style={{ marginTop: 12 }}>
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className="btn secondary block">
          {labels.cancel}
        </button>
      </form>
    </>
  );
}
