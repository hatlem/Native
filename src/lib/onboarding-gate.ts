import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";

// Call this at the top of any authenticated buyer-facing page that
// requires a completed onboarding (marketCode + phone). The previous
// approach gated at the [locale]/layout.tsx level via an x-pathname
// header threaded through middleware — but the request-header init
// from next-intl's wrapped middleware response doesn't reliably reach
// the layout in Next.js 15 (custom headers come back as missing while
// x-nonce, which is set in the same code path, does propagate;
// possibly a next-intl + NextResponse.rewrite interaction). Per-page
// guarding is the boring-but-reliable answer.
//
// Skips the gate for non-BUYER roles — desk/superadmin/publisher
// don't have an onboarding to complete and shouldn't be looped.
export async function requireOnboardingComplete(
  session: Session | null,
  locale: string,
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
  const onboardingComplete =
    !!user?.phone && !!user?.organization?.marketCode;
  if (!onboardingComplete) {
    redirect(`/${locale}/onboarding`);
  }
}
