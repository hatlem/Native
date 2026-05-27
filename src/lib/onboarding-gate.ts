import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";

// Same-origin path check. Prevents ?next=https://evil.com or //evil.com
// open redirects when bouncing the user back after onboarding.
export function safeNext(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

// Buyer onboarding (Faktureringsmarked + phone) is deferred — users
// can browse the catalog, build a plan, and explore the app without
// completing it. The gate fires at the moment of transactional intent
// (RFQ / firm-priced submit) so the desk has phone reachability and
// the billing market is known before any quote can run.
//
// Skips for non-BUYER roles — desk/superadmin/publisher don't have a
// buyer onboarding to complete.
export async function requireOnboardingBeforeBuy(
  session: Session | null,
  locale: string,
  returnTo: string,
): Promise<void> {
  if (!session?.user?.id) return;
  if (session.user.role && session.user.role !== "BUYER") return;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      phone: true,
      organization: { select: { marketCode: true } },
    },
  });
  const complete = !!user?.phone && !!user?.organization?.marketCode;
  if (!complete) {
    const next = encodeURIComponent(returnTo);
    redirect(`/${locale}/onboarding?next=${next}`);
  }
}
