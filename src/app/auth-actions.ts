"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { MarketCode } from "@prisma/client";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { landingForRole } from "@/lib/roles";

const MARKET_CODES = Object.values(MarketCode) as string[];

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

export async function register(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();
  const password = String(formData.get("password") || "");
  const name = String(formData.get("name") || "").trim();
  const orgName = String(formData.get("orgName") || "").trim();
  const marketCode = String(formData.get("market") || "").trim();

  if (
    !email ||
    password.length < 8 ||
    !orgName ||
    !MARKET_CODES.includes(marketCode)
  ) {
    redirect(`/${locale}/signup?error=1`);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  let created = false;
  try {
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: orgName,
          type: "ADVERTISER",
          marketCode: marketCode as MarketCode,
        },
      });
      await tx.user.create({
        data: {
          email,
          name: name || null,
          role: "BUYER",
          passwordHash,
          organizationId: org.id,
        },
      });
    });
    created = true;
  } catch {
    // Unique-email violation (or any create failure) — surface as a
    // friendly "already registered" rather than a 500.
  }
  if (!created) redirect(`/${locale}/signup?error=exists`);

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/${locale}/signin`);
    }
    throw error;
  }
  redirect(`/${locale}/catalog`);
}

export async function logout(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  await signOut({ redirectTo: `/${locale}` });
}
