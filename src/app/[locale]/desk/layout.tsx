import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { enforceStaffMfa } from "@/lib/mfa/enforce";
import { sectionTitleMetadata } from "@/lib/page-title";

// "Desk · NativeSpin" here, "Orders · Desk · NativeSpin" in the sub-pages.
export const generateMetadata = sectionTitleMetadata("desk");

export default async function DeskLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const role = session?.user?.role;

  if (!session?.user || (role !== "DESK" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }
  // MFA_REQUIRED_FOR_STAFF=1: no desk without two-factor. The pages and
  // actions enforce this themselves (desk-guard); this covers the shell.
  await enforceStaffMfa(session.user.id, role, locale);

  return <>{children}</>;
}
