import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { saveOnboarding } from "@/app/onboarding-actions";
import { LandingShell } from "@/app/landing-shell";
import { SubmitButton } from "@/components";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);

// Post-signup onboarding. Two questions the user couldn't be bothered
// answering at signup but the platform genuinely needs before they can
// transact: their billing market (drives VAT + invoice currency) and a
// phone number (drives desk-side reachability for time-pressured RFQs).
// Layout-level gate sends authenticated users with org.marketCode IS
// NULL here, so this page is the unblock for `/catalog` access.
export default async function OnboardingPage({
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

  const t = await getTranslations({ locale, namespace: "onboarding" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  // If the user's org already has marketCode set AND they have a phone,
  // they're done — no point sitting on this page.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      phone: true,
      name: true,
      organization: { select: { name: true, marketCode: true } },
    },
  });
  if (user?.organization?.marketCode && user.phone) {
    redirect(`/${locale}/catalog`);
  }

  const errorCode = typeof sp.error === "string" ? sp.error : undefined;

  return (
    <LandingShell locale={locale} screenLabel="Onboarding">
      <section className="auth-shell">
        <div className="marketing">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
          <ul className="signup-bullets">
            <li>{t("bullet1")}</li>
            <li>{t("bullet2")}</li>
            <li>{t("bullet3")}</li>
          </ul>
        </div>

        <div className="auth-card">
          <div className="head">
            <h2>{t("formTitle")}</h2>
            <p>{t("formLead")}</p>
          </div>

          {errorCode ? (
            <div className="banner-error" role="alert">
              <span>{t("error")}</span>
            </div>
          ) : null}

          <form action={saveOnboarding} noValidate>
            <input type="hidden" name="locale" value={locale} />
            <div className="field">
              <label htmlFor="market">{t("marketLabel")}</label>
              <select
                id="market"
                name="market"
                defaultValue={user?.organization?.marketCode ?? ""}
                required
              >
                <option value="" disabled>
                  {t("marketPlaceholder")}
                </option>
                {MARKET_CODES.map((m) => (
                  <option key={m} value={m}>
                    {tMarket(m)}
                  </option>
                ))}
              </select>
              <span className="hint">{t("marketHint")}</span>
            </div>

            <div className="field">
              <label htmlFor="phone">{t("phoneLabel")}</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                defaultValue={user?.phone ?? ""}
                required
                placeholder={t("phonePlaceholder")}
              />
              <span className="hint">{t("phoneHint")}</span>
            </div>

            <div className="actions">
              <SubmitButton
                label={t("submit")}
                pendingLabel={t("submitting")}
              />
            </div>
          </form>
        </div>
      </section>
    </LandingShell>
  );
}
