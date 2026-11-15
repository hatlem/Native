import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { appName } from "@/lib/url";
import { intlLocale } from "@/lib/money";
import { getMfaStatus, pendingSecret } from "@/lib/mfa/store";
import { groupSecret, otpauthUri } from "@/lib/mfa/totp";
import { isStaffRole, staffMfaRequired } from "@/lib/mfa/enforce";
import { landingForRole } from "@/lib/roles";
import { cookies } from "next/headers";
import {
  startMfaEnrolment,
  cancelMfaEnrolment,
  dismissRecoveryCodes,
} from "@/app/mfa-actions";
import { MFA_CODES_COOKIE, openRecoveryCodes } from "@/lib/mfa/tickets";
import { MfaPanel } from "./mfa-forms";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "mfa" });
  return { title: t("pageTitle") };
}

// Two-factor settings for the signed-in user: turn it on (secret → confirm a
// code → recovery codes), regenerate recovery codes, turn it off. Its own
// page rather than another /account section because staff are redirected
// HERE when MFA_REQUIRED_FOR_STAFF=1 and they haven't enrolled.
export default async function AccountSecurityPage({
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
  const userId = session.user.id;

  const [user, status] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, passwordHash: true, mfaEnabledAt: true, role: true },
    }),
    getMfaStatus(userId),
  ]);
  if (!user) redirect(`/${locale}/signin`);

  const t = await getTranslations({ locale, namespace: "mfa" });
  const secret = status.pending ? await pendingSecret(userId) : null;

  // Recovery codes issued a moment ago (see mfa-actions showRecoveryCodes).
  const freshCodes = status.enabled
    ? openRecoveryCodes((await cookies()).get(MFA_CODES_COOKIE)?.value, userId)
    : null;

  const staffRequired = staffMfaRequired() && isStaffRole(user.role);
  const notice = typeof sp.notice === "string" ? sp.notice : undefined;
  const noticeMessage =
    notice === "disabled"
      ? t("noticeDisabled")
      : notice === "recovery_used"
        ? t("noticeRecoveryUsed")
        : null;

  const errors = {
    invalid: t("errorInvalid"),
    rate: t("errorRate"),
    password: t("errorPassword"),
  };
  // After enrolling because the desk demanded it, "done" goes back to work.
  const doneHref =
    staffRequired && sp.codes === "enrolled"
      ? landingForRole(user.role, locale)
      : `/${locale}/account/security`;

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("pageTitle")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      {staffRequired && !status.enabled ? (
        <div className="banner-error" role="alert">
          <span>{t("requiredBanner")}</span>
        </div>
      ) : null}
      {noticeMessage ? (
        <div className="banner-info" role="status">
          <span>{noticeMessage}</span>
        </div>
      ) : null}

      <MfaPanel
        locale={locale}
        enabled={status.enabled}
        setup={
          secret
            ? {
                secretGrouped: groupSecret(secret),
                otpauthUri: otpauthUri({
                  secretBase32: secret,
                  account: user.email,
                  issuer: appName(),
                }),
              }
            : null
        }
        hasPassword={!!user.passwordHash}
        doneHref={doneHref}
        freshCodes={freshCodes}
        dismissAction={dismissRecoveryCodes}
        startAction={startMfaEnrolment}
        cancelAction={cancelMfaEnrolment}
        labels={{
          code: t("codeLabel"),
          codeOrRecovery: t("codeOrRecoveryLabel"),
          password: t("passwordLabel"),
          working: t("working"),
          errors,
          recoveryTitle: t("recoveryTitle"),
          recoveryLead: t("recoveryLead"),
          recoveryDone: t("recoveryDone"),
          statusEyebrow: t("statusEyebrow"),
          statusOn: t("statusOn"),
          statusOff: t("statusOff"),
          enabledSince: user.mfaEnabledAt
            ? t("enabledSince", {
                date: new Intl.DateTimeFormat(intlLocale(locale), {
                  dateStyle: "long",
                }).format(user.mfaEnabledAt),
              })
            : null,
          recoveryLeft: t("recoveryLeft", { count: status.recoveryCodesLeft }),
          recoveryEyebrow: t("recoveryEyebrow"),
          regenerateTitle: t("regenerateTitle"),
          regenerateLead: t("regenerateLead"),
          regenerate: t("regenerate"),
          disableEyebrow: t("disableEyebrow"),
          disableTitle: t("disableTitle"),
          disableLead: staffRequired ? t("disableLeadStaff") : t("disableLead"),
          disableCodeHint: t("disableCodeHint"),
          disable: t("disable"),
          setupTitle: t("setupTitle"),
          step1: t("step1"),
          step2: t("step2"),
          step3: t("step3"),
          setupKey: t("setupKeyLabel"),
          openInApp: t("openInApp"),
          confirm: t("confirm"),
          cancelSetup: t("cancelSetup"),
          offBody: t("offBody"),
          setupButton: t("setupButton"),
        }}
      />

      <p style={{ marginTop: 24 }}>
        <Link href="/account">{t("backToAccount")}</Link>
      </p>
    </>
  );
}
