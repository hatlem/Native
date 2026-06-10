import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { claimPublisherInvite } from "@/app/claim-actions";
import { checkInvite } from "@/lib/publisher-invite";
import { LandingShell } from "@/app/landing-shell";
import { SubmitButton } from "@/components";

export const dynamic = "force-dynamic";

// Publisher portal claim page. Renders the invite-bound signup form
// when the token is valid; renders a clear refusal otherwise. The
// claim action lives in auth-actions because it's a one-shot
// account-creation flow with built-in sign-in at the end (parallels
// register()).
export default async function ClaimPublisherInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, token } = await params;
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;

  const session = await auth();
  if (session?.user) {
    // Already signed in — don't let an authenticated user accidentally
    // claim a colleague's invite on their session. Send them to the
    // portal landing.
    redirect(`/${locale}/publisher`);
  }

  const t = await getTranslations({ locale, namespace: "auth" });
  const tc = await getTranslations({ locale, namespace: "common" });

  const invite = await prisma.publisherInvite.findUnique({
    where: { token },
    include: { publisher: { select: { name: true } } },
  });
  const verdict = checkInvite(invite);

  if (!invite || !verdict || !verdict.ok) {
    const reason = !invite
      ? "not-found"
      : verdict && !verdict.ok
        ? verdict.reason
        : "invalid";
    return (
      <LandingShell locale={locale} screenLabel="Invite invalid">
        <div className="utility-page" role="alert">
          <span className="utility-code">!</span>
          <h1>{t("inviteInvalidTitle")}</h1>
          <p className="lead">
            {reason === "expired"
              ? t("inviteExpiredBody")
              : reason === "claimed"
                ? t("inviteClaimedBody")
                : t("inviteUnknownBody")}
          </p>
          <div className="cluster">
            <Link href="/" className="btn primary">
              {t("backHome")}
            </Link>
          </div>
        </div>
      </LandingShell>
    );
  }

  return (
    <LandingShell locale={locale} screenLabel="Publisher claim">
      <section className="auth-shell">
        <div className="marketing">
          <span className="eyebrow accent">{tc("appName")}</span>
          <h1>{t("claimHeadline", { publisher: invite.publisher.name })}</h1>
          <p className="lead">{t("claimLead")}</p>
          <ul className="signup-bullets">
            <li>{t("claimBullet1")}</li>
            <li>{t("claimBullet2")}</li>
            <li>{t("claimBullet3")}</li>
          </ul>
        </div>

        <div className="auth-card">
          <div className="head">
            <h2>{t("claimTitle")}</h2>
            <p>{t("claimSubtitle", { publisher: invite.publisher.name })}</p>
          </div>

          {error ? (
            <div className="banner-error" role="alert">
              <span>{t("claimError")}</span>
            </div>
          ) : null}

          <form action={claimPublisherInvite} noValidate>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <div className="field">
              <label htmlFor="claim-name">{t("name")}</label>
              <input
                id="claim-name"
                name="name"
                autoComplete="name"
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label htmlFor="claim-email">{t("email")}</label>
              <input
                id="claim-email"
                name="email"
                type="email"
                defaultValue={invite.email}
                readOnly
                autoComplete="email"
              />
              <span className="hint">{t("claimEmailLockedHint")}</span>
            </div>
            <div className="field">
              <label htmlFor="claim-password">{t("password")}</label>
              <input
                id="claim-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <span className="hint">{t("pwHint")}</span>
            </div>
            <div className="actions">
              <SubmitButton
                label={t("claimSubmit")}
                pendingLabel={t("claimSubmitting")}
              />
            </div>
          </form>

          <div className="alt">
            {t("haveAccount")} <Link href="/signin">{t("signin")}</Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
