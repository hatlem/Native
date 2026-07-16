import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { checkOrgInvite } from "@/lib/org-invite";
import { claimOrgInvite } from "@/app/org-invite-actions";
import { logout } from "@/app/auth-actions";
import { LandingShell } from "@/app/landing-shell";
import { SubmitButton } from "@/components";

export const dynamic = "force-dynamic";

// Org invite claim page. Four states:
//   1. Invalid token (missing/expired/claimed) → friendly unavailable message.
//   2. Logged in as the invited email → one-click Accept form.
//   3. Logged in as a different email → mismatch notice + sign-out form.
//   4. Not logged in → account-creation form (email pinned, name + password).
export default async function OrgInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, token } = await params;
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;

  const t = await getTranslations({ locale, namespace: "invite" });
  const ta = await getTranslations({ locale, namespace: "auth" });

  const invite = await prisma.orgInvite.findUnique({
    where: { token },
    select: {
      email: true,
      expiresAt: true,
      claimedAt: true,
      organizationId: true,
      organization: { select: { name: true } },
    },
  });

  const verdict = checkOrgInvite(invite);

  // --- State 1: Invalid invite ---
  if (!verdict.ok) {
    return (
      <LandingShell locale={locale} screenLabel="Invite unavailable">
        <div className="utility-page" role="alert">
          <span className="utility-code">!</span>
          <h1>{t("unavailableTitle")}</h1>
          <p className="lead">{t("unavailableBody")}</p>
          <div className="cluster">
            <Link href="/" className="btn primary">
              {ta("backHome")}
            </Link>
          </div>
        </div>
      </LandingShell>
    );
  }

  const session = await auth();
  const authedEmail = session?.user?.email?.toLowerCase() ?? null;
  const inviteEmail = invite!.email.toLowerCase();
  const orgName = invite!.organization.name;
  const emailMatches = authedEmail !== null && authedEmail === inviteEmail;

  // --- State 3: Logged in as a different email ---
  if (authedEmail !== null && !emailMatches) {
    return (
      <LandingShell locale={locale} screenLabel="Wrong account">
        <div className="utility-page" role="alert">
          <span className="utility-code">!</span>
          <h1>{t("wrongAccountTitle")}</h1>
          <p className="lead">
            {t("wrongAccountBody", {
              inviteEmail: invite!.email,
              authedEmail: session!.user!.email!,
            })}
          </p>
          <div className="cluster">
            <form action={logout}>
              <input type="hidden" name="locale" value={locale} />
              <button type="submit" className="btn secondary">
                {t("signOut")}
              </button>
            </form>
          </div>
        </div>
      </LandingShell>
    );
  }

  // --- State 2: Logged in as the invited email ---
  if (emailMatches) {
    return (
      <LandingShell locale={locale} screenLabel="Accept invitation">
        <section className="auth-shell">
          <div className="marketing">
            <h1>{t("title", { org: orgName })}</h1>
            <p className="lead">{t("invitationFor", { email: invite!.email })}</p>
          </div>

          <div className="auth-card">
            <div className="head">
              <h2>{t("title", { org: orgName })}</h2>
              <p>{t("invitationFor", { email: invite!.email })}</p>
            </div>

            {error ? (
              <div className="banner-error" role="alert">
                <span>{t("genericError")}</span>
              </div>
            ) : null}

            <form action={claimOrgInvite} noValidate>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="token" value={token} />
              <div className="actions">
                <SubmitButton
                  label={t("accept")}
                  pendingLabel={ta("signingIn")}
                />
              </div>
            </form>
          </div>
        </section>
      </LandingShell>
    );
  }

  // --- State 4: Not logged in → account-creation form ---
  return (
    <LandingShell locale={locale} screenLabel="Create account">
      <section className="auth-shell">
        <div className="marketing">
          <h1>{t("title", { org: orgName })}</h1>
          <p className="lead">{t("invitationFor", { email: invite!.email })}</p>
        </div>

        <div className="auth-card">
          <div className="head">
            <h2>{t("title", { org: orgName })}</h2>
            <p>{t("invitationFor", { email: invite!.email })}</p>
          </div>

          {error ? (
            <div className="banner-error" role="alert">
              <span>{t("genericError")}</span>
            </div>
          ) : null}

          <form action={claimOrgInvite} noValidate>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <div className="field">
              <label htmlFor="invite-email">{ta("email")}</label>
              <input
                id="invite-email"
                name="email"
                type="email"
                defaultValue={invite!.email}
                readOnly
                autoComplete="email"
              />
            </div>
            <div className="field">
              <label htmlFor="invite-name">{ta("name")}</label>
              <input
                id="invite-name"
                name="name"
                autoComplete="name"
                placeholder={t("namePlaceholder")}
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label htmlFor="invite-password">{ta("password")}</label>
              <input
                id="invite-password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder={t("passwordPlaceholder")}
                minLength={8}
              />
              <span className="hint">{t("passwordOptionalHint")}</span>
            </div>
            <div className="actions">
              <SubmitButton
                label={t("createAndJoin")}
                pendingLabel={ta("creatingAccount")}
              />
            </div>
          </form>

          <div className="alt">
            {ta("haveAccount")} <Link href="/signin">{ta("signin")}</Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
