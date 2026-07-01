import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { safeNext } from "@/lib/onboarding-gate";
import { LandingShell } from "@/app/landing-shell";
import { GetTalkBooking } from "@/components";

export const dynamic = "force-dynamic";

export default async function OnboardingCallPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/signin`);

  // Reachable only after onboarding proper (market + phone) is complete.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { phone: true, organization: { select: { marketCode: true } } },
  });
  if (!user?.organization?.marketCode || !user.phone) {
    redirect(`/${locale}/onboarding`);
  }

  const next = safeNext(
    typeof sp.next === "string" ? sp.next : undefined,
    `/${locale}/catalog`,
  );
  const t = await getTranslations({ locale, namespace: "onboarding" });

  return (
    <LandingShell locale={locale} screenLabel="Onboarding">
      <section className="onboarding-call wrap">
        <h1>{t("callHeading")}</h1>
        <p className="lead">{t("callBody")}</p>
        <GetTalkBooking mode="inline" text={t("callCta")} />
        <p>
          <a href={next}>{t("callSkip")}</a>
        </p>
      </section>
    </LandingShell>
  );
}
