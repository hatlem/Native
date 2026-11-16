import { redirect } from "next/navigation";
import { isMfaEnabled } from "./store";

// Staff two-factor requirement. OFF by default so a deploy never locks the
// desk out; turn on with MFA_REQUIRED_FOR_STAFF=1 once every DESK/SUPERADMIN
// user has had the chance to enrol (they are sent to the enrolment page on
// their next desk request, so "the chance" is one click).

export function staffMfaRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MFA_REQUIRED_FOR_STAFF === "1";
}

export function isStaffRole(role: string | null | undefined): boolean {
  return role === "DESK" || role === "SUPERADMIN";
}

/** Where a staff user without two-factor is sent. */
export function mfaEnrolPath(locale: string): string {
  return `/${locale}/account/security?required=1`;
}

// Server-side gate, called from the desk guards (pages AND actions): with the
// requirement on, a staff user who has not enabled two-factor cannot use the
// desk at all — they are redirected to enrol. One primary-key read, and only
// when the flag is on.
export async function enforceStaffMfa(
  userId: string,
  role: string | null | undefined,
  locale: string,
): Promise<void> {
  if (!staffMfaRequired() || !isStaffRole(role)) return;
  if (await isMfaEnabled(userId)) return;
  redirect(mfaEnrolPath(locale));
}
