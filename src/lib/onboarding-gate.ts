import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import type { MarketCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getWorkspace, loadWorkspace } from "@/lib/workspace";

// Re-exported: onboarding was the first user of the same-origin `next` check.
export { safeNext } from "@/lib/auth-gate";

// Onboarding is first-time org setup, done once by whoever may set the org's
// billing market: an ADMIN (in practice the org creator — signup makes them
// its first admin) or an agency for a client it manages. It asks for the
// market (VAT + invoice currency on every future quote) and the creator's
// phone (so the desk can reach the org fast on time-sensitive RFQs).
//
// Once the org has a market it is onboarded, for everyone: a member invited
// into it skips onboarding entirely — no questions, no phone (the creator's
// details are enough) — and onboarding can never change the market again.
// Changing it later is an admin action under /account.
export type OnboardingNeeds = {
  // Ask this user for the org's billing market (and their phone).
  askMarket: boolean;
  // The org has no billing market and this user can't set it: an admin has
  // to finish onboarding before the team can transact.
  marketBlocked: boolean;
  complete: boolean;
};

export function onboardingNeeds(input: {
  orgMarketCode: string | null;
  canSetMarket: boolean;
}): OnboardingNeeds {
  const hasMarket = !!input.orgMarketCode;
  return {
    askMarket: !hasMarket && input.canSetMarket,
    marketBlocked: !hasMarket && !input.canSetMarket,
    complete: hasMarket,
  };
}

export type OnboardingState = OnboardingNeeds & {
  userId: string;
  phone: string | null;
  // The org being onboarded: the one the user is working in (the switched-to
  // org for a member of several, the selected client for an agency) — the
  // same org checkout mints the quote for.
  org: { id: string; name: string; marketCode: MarketCode | null } | null;
};

// `orgId` names the org explicitly (checkout acts on the org of the plan it
// submits, which a stale tab may not have switched to); by default it is the
// org the user is working in.
export async function loadOnboardingState(userId: string, orgId?: string): Promise<OnboardingState> {
  const ws = orgId ? await loadWorkspace(userId, orgId) : await getWorkspace(userId);
  const [user, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }),
    ws?.activeOrgId
      ? prisma.organization.findUnique({
          where: { id: ws.activeOrgId },
          select: { id: true, name: true, marketCode: true },
        })
      : Promise.resolve(null),
  ]);
  const canSetMarket = !!ws && !!org && (ws.isAgency || ws.activeRole === "ADMIN");
  return {
    userId,
    phone: user?.phone ?? null,
    org,
    ...onboardingNeeds({ orgMarketCode: org?.marketCode ?? null, canSetMarket }),
  };
}

// Onboarding is deferred — users can browse the catalog, build a plan, and
// explore the app without completing it. The gate fires at the moment of
// transactional intent (RFQ / firm-priced submit) so the billing market is
// known before any quote can run.
//
// Skips for non-BUYER roles — desk/superadmin/publisher don't have a
// buyer onboarding to complete.
export async function requireOnboardingBeforeBuy(
  session: Session | null,
  locale: string,
  returnTo: string,
  orgId?: string,
): Promise<void> {
  if (!session?.user?.id) return;
  if (session.user.role && session.user.role !== "BUYER") return;
  const state = await loadOnboardingState(session.user.id, orgId);
  if (!state.complete) {
    const next = encodeURIComponent(returnTo);
    redirect(`/${locale}/onboarding?next=${next}`);
  }
}
