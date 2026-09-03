// Banner copy for /desk/users, keyed by the ?ok= / ?error= codes that
// @/app/user-admin-actions redirects with. Same shape and same reasoning as
// @/lib/account-messages: a lookup table plus a parity test, so a new code
// can't ship as a page that reloads with no explanation.
//
// Values are keys in the `deskUsers` message namespace.

export const DESK_USERS_OK_KEYS: Readonly<Record<string, string>> = {
  role: "okRole",
  org: "okOrg",
  publisher: "okPublisher",
  deactivated: "okDeactivated",
  reactivated: "okReactivated",
  reset_sent: "okResetSent",
  link_sent: "okLinkSent",
};

export const DESK_USERS_ERROR_KEYS: Readonly<Record<string, string>> = {
  // The three AdminDenyReason values from @/lib/user-admin, which the actions
  // pass straight through as codes.
  self: "errSelf",
  last_superadmin: "errLastSuperadmin",
  not_found: "errNotFound",
  role: "errRole",
  deactivated_target: "errDeactivatedTarget",
  email_failed: "errEmailFailed",
};

const GENERIC_ERROR_KEY = "errGeneric";

export function deskUsersOkKey(code: string | undefined): string | null {
  if (!code) return null;
  return DESK_USERS_OK_KEYS[code] ?? null;
}

export function deskUsersErrorKey(code: string | undefined): string | null {
  if (!code) return null;
  return DESK_USERS_ERROR_KEYS[code] ?? GENERIC_ERROR_KEY;
}
