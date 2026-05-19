"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";

export async function authenticate(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: `/${locale}/desk`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/${locale}/signin?error=1`);
    }
    // Re-throw the NEXT_REDIRECT control-flow error so navigation happens.
    throw error;
  }
}

export async function logout(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  await signOut({ redirectTo: `/${locale}` });
}
