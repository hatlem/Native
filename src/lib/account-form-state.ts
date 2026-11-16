// State the /account server actions return to their forms (useActionState).
// A validation failure comes back here — with what was typed, minus any
// password — and renders next to the field it is about, instead of a
// redirect to /account?error=… that reloaded the page and emptied the form.
//
// `error` is the same code the old ?error= redirects carried, so the copy
// (lib/account-messages) and the field mapping (lib/account-error-field) are
// shared with the forms that still redirect (company, team).

export type AccountFormState = {
  error: string | null;
  // Field name → value to put back in the form. Never a password.
  values: Readonly<Record<string, string>>;
};

export const INITIAL_ACCOUNT_FORM_STATE: AccountFormState = { error: null, values: {} };

export function accountFail(
  error: string,
  values: Readonly<Record<string, string>> = {},
): AccountFormState {
  return { error, values };
}
