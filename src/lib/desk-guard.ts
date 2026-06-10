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
