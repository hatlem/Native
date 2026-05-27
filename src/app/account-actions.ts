"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

const MARKET_CODES = Object.values(MarketCode) as string[];

// Same lenient phone validator as onboarding — keep both in sync.
function normalisePhone(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}
function isValidPhone(raw: string): boolean {
  if (raw.length === 0) return true; // clearing phone is allowed
  const digits = raw.match(/\d/g)?.length ?? 0;
  return raw.length <= 32 && digits >= 6;
}

export async function updateProfile(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const name = String(formData.get("name") || "").trim();
  const phoneRaw = String(formData.get("phone") || "");
  const phone = normalisePhone(phoneRaw);

  if (!isValidPhone(phone)) {
    redirect(`/${locale}/account?error=phone#profile`);
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name: name || null,
      phone: phone || null,
    },
  });
  await recordAudit(session.user.id, "user.profile_updated", `User:${session.user.id}`, {
    fields: ["name", "phone"],
  });
  redirect(`/${locale}/account?ok=profile#profile`);
}

export async function updateCompany(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const orgName = String(formData.get("orgName") || "").trim();
  const market = String(formData.get("market") || "").trim();

  if (!orgName || !MARKET_CODES.includes(market)) {
    redirect(`/${locale}/account?error=company#company`);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true, role: true },
  });
  if (!user?.organizationId) {
    redirect(`/${locale}/account?error=no_org#company`);
  }
  // Only org admins + the user's own org can edit company info. v1
  // keeps this loose: any BUYER role on the org can edit (single-seat
  // is the common case). Tighten when multi-seat lands.
  await prisma.organization.update({
    where: { id: user.organizationId },
    data: {
      name: orgName,
      marketCode: market as MarketCode,
    },
  });
  await recordAudit(session.user.id, "organization.updated", `Organization:${user.organizationId}`, {
    name: orgName,
    market,
  });
  redirect(`/${locale}/account?ok=company#company`);
}

// Set or change the user's password. If the user signed up via magic-
// link and has no password yet, currentPassword is not required. If a
// password already exists, we verify the current one before accepting
// the new one — same UX as resetPassword but in the signed-in flow.
export async function setPassword(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const current = String(formData.get("currentPassword") || "");
  const next = String(formData.get("newPassword") || "");
  if (next.length < 8) {
    redirect(`/${locale}/account?error=password_length#password`);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true, email: true },
  });
  if (!user) redirect(`/${locale}/signin`);

  if (user.passwordHash) {
    // Existing-password users must prove they know it.
    const ok = await bcrypt.compare(current, user.passwordHash);
    if (!ok) {
      redirect(`/${locale}/account?error=current_password#password`);
    }
  }

  const hash = await bcrypt.hash(next, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hash },
  });
  await recordAudit(user.id, "user.password_set", `User:${user.id}`, {
    hadPasswordBefore: !!user.passwordHash,
  });
  redirect(`/${locale}/account?ok=password#password`);
}
