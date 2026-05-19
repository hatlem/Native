"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";

function landingForRole(role: string | undefined, locale: string): string {
  switch (role) {
    case "PUBLISHER":
      return `/${locale}/publisher`;
    case "DESK":
    case "SUPERADMIN":
      return `/${locale}/desk`;
    default:
      return `/${locale}/catalog`;
  }
}

export async function authenticate(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();
  const password = String(formData.get("password") || "");

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/${locale}/signin?error=1`);
    }
    throw error;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });
  // Outside the try: redirect() throws NEXT_REDIRECT, which must not be caught.
  redirect(landingForRole(user?.role, locale));
}

export async function logout(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  await signOut({ redirectTo: `/${locale}` });
}
