import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

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

  return <>{children}</>;
}
