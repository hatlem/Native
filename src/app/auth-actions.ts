"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { MarketCode } from "@prisma/client";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { landingForRole } from "@/lib/roles";
import { authLimiter } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

const MARKET_CODES = Object.values(MarketCode) as string[];

async function clientKey(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

export async function authenticate(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim();
  const password = String(formData.get("password") || "");

  // Rate-limit on the email AND the source IP — the attacker controls both
  // independently so we want either to slow them down.
  const ip = await clientKey();
  if (!authLimiter.check(`signin:ip:${ip}`).ok || !authLimiter.check(`signin:email:${email}`).ok) {
    redirect(`/${locale}/signin?error=rate`);
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      await recordAudit(email || "anonymous", "auth.signin_failed", `User:${email}`, { ip });
      redirect(`/${locale}/signin?error=1`);
    }
    throw error;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  await recordAudit(user?.id ?? email, "auth.signin", `User:${email}`, { ip });
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

  const ip = await clientKey();
  if (!authLimiter.check(`signup:ip:${ip}`).ok) {
    redirect(`/${locale}/signup?error=rate`);
  }

  if (
    !email ||
    password.length < 8 ||
    !orgName ||
    !MARKET_CODES.includes(marketCode)
  ) {
    redirect(`/${locale}/signup?error=1`);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  let createdUserId: string | null = null;
  try {
    createdUserId = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: orgName,
          type: "ADVERTISER",
          marketCode: marketCode as MarketCode,
        },
      });
      const user = await tx.user.create({
        data: {
          email,
          name: name || null,
          role: "BUYER",
          passwordHash,
          organizationId: org.id,
        },
      });
      return user.id;
    });
  } catch {
    // Unique-email violation (or any create failure) — surface as a
    // friendly "already registered" rather than a 500.
  }
  if (!createdUserId) redirect(`/${locale}/signup?error=exists`);
  await recordAudit(createdUserId, "user.register", `User:${email}`, { ip, orgName });

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
