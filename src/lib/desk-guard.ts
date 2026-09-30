import { redirect } from "next/navigation";
import { auth } from "@/auth";

// Gate a desk-only server action: anyone without the DESK or SUPERADMIN
// role is bounced to sign-in. Returns the acting user id for audit rows.
// Same shape as requireLineWriter in @/lib/writers/guard.
export async function requireDesk(locale: string): Promise<string> {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
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
  return { allowed: true, userId: session.user.id };
}
