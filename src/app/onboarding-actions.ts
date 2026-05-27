"use server";

import { redirect } from "next/navigation";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { safeNext } from "@/lib/onboarding-gate";
import { recordAudit } from "@/lib/audit";

const MARKET_CODES = Object.values(MarketCode) as string[];

// Phone format: keep the validation forgiving — international users
// type with spaces, country prefixes (+47, +46, +45, …), dashes, and
// the Norwegian convention of grouping into 3-digit blocks. We accept
// anything that has at least 6 digits in it and is at most 32 chars
// total, then strip the user-visible whitespace for storage.
const PHONE_DIGIT_RE = /\d/g;

function normalisePhone(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function isValidPhone(raw: string): boolean {
  const digits = raw.match(PHONE_DIGIT_RE)?.length ?? 0;
  return raw.length <= 32 && digits >= 6;
}

// Save onboarding (post-signup) details: Faktureringsmarked on the
// user's org + phone on the user. Onboarding is deferred — a user
// only lands here when they trigger a buy/RFQ without these fields,
// so on success we redirect back to wherever the gate fired from
// (defaults to /catalog when arrived at directly).
export async function saveOnboarding(formData: FormData) {
  const locale = String(formData.get("locale") || "en");
  const next = safeNext(
    String(formData.get("next") || ""),
    `/${locale}/catalog`,
  );
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const market = String(formData.get("market") || "").trim();
  const phoneRaw = String(formData.get("phone") || "");
  const phone = normalisePhone(phoneRaw);

  if (!MARKET_CODES.includes(market) || !isValidPhone(phone)) {
    redirect(
      `/${locale}/onboarding?error=1&next=${encodeURIComponent(next)}`,
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, organizationId: true },
  });
  if (!user?.organizationId) {
    // Edge case: user without an org (e.g. publisher invite mid-claim).
    // Onboarding doesn't apply — bounce them home.
    redirect(`/${locale}/`);
  }

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: user.organizationId },
      data: { marketCode: market as MarketCode },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { phone },
    }),
  ]);

  await recordAudit(user.id, "user.onboarding_completed", `User:${user.id}`, {
    market,
    hasPhone: true,
  });

  redirect(next);
}
