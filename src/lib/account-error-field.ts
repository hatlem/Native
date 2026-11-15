// Which /account input an ?error= code is about, so the page can tie the
// banner to that field (aria-invalid + aria-describedby + focus) instead of
// leaving the person to work out which of six forms failed.

const FIELD_BY_ERROR: Readonly<Record<string, string>> = {
  phone: "acc-phone",
  company: "acc-org",
  password_length: "acc-pw-new",
  current_password: "acc-pw-current",
  email: "acc-new-email",
  email_invalid: "acc-new-email",
  email_taken: "acc-new-email",
  email_same: "acc-new-email",
  email_business: "acc-new-email",
  email_domain: "acc-new-email",
  email_password: "acc-email-pw",
  confirm: "acc-deactivate-confirm",
};

/** DOM id of the input the error belongs to, or null for a form-level error. */
export function accountErrorFieldId(code: string | undefined): string | null {
  if (!code) return null;
  return Object.hasOwn(FIELD_BY_ERROR, code) ? FIELD_BY_ERROR[code] : null;
}
