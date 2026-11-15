import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { enforceStaffMfa } from "@/lib/mfa/enforce";

// Gate a desk-only server action: anyone without the DESK or SUPERADMIN
// role is bounced to sign-in. Returns the acting user id for audit rows.
// Same shape as requireLineWriter in @/lib/writers/guard.
export async function requireDesk(locale: string): Promise<string> {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  // MFA_REQUIRED_FOR_STAFF=1: staff without two-factor are sent to enrol.
  await enforceStaffMfa(session.user.id, role, locale);
  return session.user.id;
}

export type SuperadminPageGate =
  | { allowed: true; userId: string }
  | { allowed: false };

// Gate for a SUPERADMIN-only desk *page*. Signed-out visitors go to
// sign-in (so the callback lands them back here). A signed-in user with
// any other role is NOT redirected: the caller renders <SuperadminOnly />
// instead. A silent bounce to /desk made DESK users conclude the link was
// broken — an explicit "this page is for superadmins" state tells them
// the page exists, why they can't see it, and who to ask.
//
//   const gate = await superadminPageGate(locale);
//   if (!gate.allowed) return <SuperadminOnly locale={locale} area={t("title")} />;
export async function superadminPageGate(locale: string): Promise<SuperadminPageGate> {
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);
  if (session.user.role !== "SUPERADMIN") return { allowed: false };
  await enforceStaffMfa(session.user.id, session.user.role, locale);
  return { allowed: true, userId: session.user.id };
}

// Gate a SUPERADMIN-only server action. Anyone else is bounced to
// `redirectTo` (sign-in by default). Returns the acting user id for audit
// rows. The one definition of this check — it used to be copy-pasted into
// each actions file, which is how a guard goes missing.
export async function requireSuperadmin(
  locale: string,
  redirectTo: string = `/${locale}/signin`,
): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SUPERADMIN") {
    redirect(redirectTo);
  }
  await enforceStaffMfa(session.user.id, session.user.role, locale);
  return session.user.id;
}

// requireDesk for callers that need the whole session user (name, email).
export async function requireDeskSession(locale: string) {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  await enforceStaffMfa(session.user.id, role, locale);
  return session.user;
}
