import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageTitleMetadata } from "@/lib/page-title";

// Guards the publisher portal proper. It sits on the (portal) route group, not
// on /publisher itself, because /publisher/claim/<token> must stay reachable
// signed out: that page is where an invited publisher CREATES their account,
// so a "sign in first" guard above it made every publisher invite a dead end.
// The claim page does its own checks (token validity, already signed in).
export const generateMetadata = pageTitleMetadata("publisher");

export default async function PublisherLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const role = session?.user?.role;

  if (!session?.user || (role !== "PUBLISHER" && role !== "SUPERADMIN")) {
    redirect(`/${locale}/signin`);
  }

  return <>{children}</>;
}
