"use server";

import { redirect } from "next/navigation";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadOnboardingState, safeNext } from "@/lib/onboarding-gate";
import { recordAudit } from "@/lib/audit";
import { SUPPORTED_MARKETS } from "@/lib/markets";
import {
  normalisePhone,
  validateOnboarding,
  type OnboardingState,
} from "@/lib/onboarding-form-state";

const MARKET_CODES: readonly string[] = SUPPORTED_MARKETS;

// Phone / market validation lives in lib/onboarding-form-state (pure, tested).

// Save first-time org onboarding: the billing market on the org being
// onboarded plus the phone of the person onboarding it. Only someone allowed
// to set the market, and only while the org has none (lib/onboarding-gate
// onboardingNeeds); anyone else — a member invited into an org that is
// already set up — has nothing to save here, and a market posted by them is
// never written. Onboarding is deferred: a user only lands here when they
// trigger a buy/RFQ first, so on success we redirect back to wherever the
// gate fired from (defaults to /catalog when arrived at directly).
export async function saveOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const locale = String(formData.get("locale") || "en");
  const next = safeNext(
    String(formData.get("next") || ""),
    `/${locale}/catalog`,
  );
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  const state = await loadOnboardingState(session.user.id);
  if (!state.org) {
    // Edge case: user without an org to onboard (e.g. publisher invite
    // mid-claim, or a member whose access was removed). Onboarding doesn't
    // apply — bounce them home.
    redirect(`/${locale}/`);
  }
  // Already onboarded (nothing to ask), or waiting on an admin (the page
  // says so): nothing to write either way.
  if (state.complete) redirect(next);
  if (!state.askMarket) {
    redirect(`/${locale}/onboarding?next=${encodeURIComponent(next)}`);
  }

  const market = String(formData.get("market") || "").trim();
  const phone = normalisePhone(String(formData.get("phone") || ""));
  // Field-level errors go back to the form in place, with what was typed.
  const errors = validateOnboarding({ market, phone }, MARKET_CODES);
  if (errors.market || errors.phone) return { errors, values: { market, phone } };

  await prisma.$transaction([
    // Conditional on the market still being unset: two admins racing through
    // first-time onboarding can't overwrite each other, and this path can
    // never change a market that has already been chosen.
    prisma.organization.updateMany({
      where: { id: state.org.id, marketCode: null },
      data: { marketCode: market as MarketCode },
    }),
    prisma.user.update({
      where: { id: state.userId },
      data: { phone },
    }),
  ]);

  await recordAudit(state.userId, "user.onboarding_completed", `User:${state.userId}`, {
    organizationId: state.org.id,
    market,
    hasPhone: true,
  });

  redirect(`/${locale}/onboarding/call?next=${encodeURIComponent(next)}`);
}
