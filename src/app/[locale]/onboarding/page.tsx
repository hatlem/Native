import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { loadOnboardingState, safeNext } from "@/lib/onboarding-gate";
import { saveOnboarding } from "@/app/onboarding-actions";
import { LandingShell } from "@/app/landing-shell";
import { SubmitButton } from "@/components";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);

// Post-signup onboarding. Two questions the user couldn't be bothered
// answering at signup but the platform genuinely needs before they can
// transact: their billing market (drives VAT + invoice currency) and a
// phone number (drives desk-side reachability for time-pressured RFQs).
// The buy gate (lib/onboarding-gate) sends users here; only someone who may
// set the org's market (onboardingNeeds) is asked for it.
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

  // Where to send the user after onboarding completes. Defaults to
  // /catalog when arrived at directly; the buy-gate threads /plan so a
  // user who hit "Send request" lands back on the basket with brief
  // intact. safeNext blocks open-redirect attempts via ?next=//evil.
  const next = safeNext(
    typeof sp.next === "string" ? sp.next : undefined,
    `/${locale}/catalog`,
  );

  // Onboarded already — for a member invited into a set-up org that is from
  // their very first visit — so there is nothing to ask.
  const state = await loadOnboardingState(session.user.id);
  if (state.complete) {
    redirect(next);
  }
  // Nothing to onboard (no org to work in): same bounce as saveOnboarding.
  if (!state.org) redirect(`/${locale}/`);
  const orgName = state.org.name;

  // The org isn't set up and this user can't set it up: say who can,
  // instead of a form they have no right to submit.
  if (state.marketBlocked) {
    return (
      <LandingShell locale={locale} screenLabel="Onboarding">
        <div className="utility-page" role="status">
          <span className="eyebrow accent">{t("eyebrow")}</span>
          <h1>{t("blockedTitle", { org: orgName })}</h1>
          <p className="lead">{t("marketBlocked", { org: orgName })}</p>
          <div className="cluster">
            <a href={next} className="btn primary">
              {t("blockedBack")}
            </a>
          </div>
        </div>
      </LandingShell>
    );
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
            <input type="hidden" name="next" value={next} />
            <div className="field">
              <label htmlFor="market">{t("marketLabel")}</label>
              <select
                id="market"
                name="market"
                defaultValue={state.org.marketCode ?? ""}
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
                defaultValue={state.phone ?? ""}
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
