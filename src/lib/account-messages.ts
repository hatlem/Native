// Banner copy for /account, keyed by the ?ok= / ?error= codes the account
// server actions redirect with.
//
// This used to be a 15-deep ternary chain inline in the page, and six codes the
// actions actually emit (`no_org`, `role`, `email`, `delegation`,
// `delegation_past` and the bare `1`) had no branch at all — those failures
// reloaded the page with no banner and no explanation, which reads to the user
// as "the button does nothing". A lookup table plus the parity test next door
// makes that class of bug impossible to reintroduce: an unmapped error code now
// falls back to a generic message instead of rendering silence, and the test
// fails the build if a new code ships unmapped.

// Values are keys in the `account` message namespace (src/messages/*.json).
export const ACCOUNT_OK_KEYS: Readonly<Record<string, string>> = {
  profile: "okProfile",
  company: "okCompany",
  password: "okPassword",
  invited: "okInvited",
  revoked: "okRevoked",
  updated: "okUpdated",
  invite_revoked: "okInviteRevoked",
  joined: "okJoined",
  email_requested: "okEmailRequested",
  email_changed: "okEmailChanged",
};

export const ACCOUNT_ERROR_KEYS: Readonly<Record<string, string>> = {
  phone: "errPhone",
  company: "errCompany",
  password_length: "errPasswordLength",
  current_password: "errCurrentPassword",
  forbidden: "errForbidden",
  last_admin: "errLastAdmin",
  already_member: "errAlreadyMember",
  admin_delegation: "errAdminDelegation",
  // inviteToOrg's two delegation-date codes, silent until now.
  delegation: "errDelegation",
  delegation_past: "errDelegationPast",
  no_org: "errNoOrg",
  role: "errRole",
  // inviteToOrg's own "that isn't an address" code, which predates this table
  // and was another of the silent ones.
  email: "errEmailInvalid",
  email_invalid: "errEmailInvalid",
  email_taken: "errEmailTaken",
  email_same: "errEmailSame",
  email_password: "errEmailPassword",
  email_expired: "errEmailExpired",
  email_business: "errEmailBusiness",
  rate: "errRate",
  confirm: "errConfirm",
  last_superadmin: "errLastSuperadmin",
  // The bare `?error=1` a few actions emit for "missing form field" — a bug
  // report, not a user mistake, so it gets the generic wording too.
  "1": "errGeneric",
};

const GENERIC_ERROR_KEY = "errGeneric";

// Unknown ok-codes stay silent: a success banner we can't word is worse than
// none, and no action emits one we don't know about (the parity test proves it).
export function accountOkKey(code: string | undefined): string | null {
  if (!code) return null;
  return ACCOUNT_OK_KEYS[code] ?? null;
}

// Unknown error codes are NEVER silent — the whole point of this module.
export function accountErrorKey(code: string | undefined): string | null {
  if (!code) return null;
  return ACCOUNT_ERROR_KEYS[code] ?? GENERIC_ERROR_KEY;
}
