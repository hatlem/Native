import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadScope } from "@/lib/scope";
import { companySeat } from "@/lib/workspace";
import { updateCompany } from "@/app/account-actions";
import { DeactivateForm, EmailChangeForm, PasswordForm, ProfileForm } from "./account-forms";
import { accountOkKey, accountErrorKey } from "@/lib/account-messages";
import { SubmitButton } from "@/components";
import { TeamSection } from "./team-section";
import { LocaleSwitcher } from "./locale-switcher";
import { SUPPORTED_MARKETS } from "@/lib/markets";

import { NotificationPrefsSection } from "./notification-prefs-section";
import { FieldErrorLink } from "./field-error-link";
import { accountErrorFieldId } from "@/lib/account-error-field";
export const dynamic = "force-dynamic";

const MARKET_CODES = SUPPORTED_MARKETS;

// Authenticated-user account/profile page. One section per concern, each
// scoped to its own form + server action:
//   - Profile (name, phone)
//   - Language
//   - Sign-in email (confirm-to-new-address change flow)
//   - Company (org name + billing market)
//   - Password (set or change)
//   - Team (org admins)
//   - Data & account (export, deactivate)
//
// Lives in the same authenticated layout as /catalog, /plan etc. so
// users get the standard nav around it. Profile, email, password and
// deactivation are useActionState forms (./account-forms): their errors
// render at the field and keep the input. Success banners, and errors from
// the forms that still redirect (company, team), are keyed by ?ok= / ?error=.
export default async function AccountPage({
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

  const scope = await loadScope();
  const ws = scope.workspace;
  // Company card = the org the user is working in (the switched-to org for a
  // member of several; an agency's own company) — the same org updateCompany
  // writes. Admin-only to edit (server-enforced); other seats see it read-only.
  const seat = ws ? companySeat(ws) : null;
  const isOrgAdmin = !!seat?.isAdmin;
  const company = seat?.orgId
    ? await prisma.organization.findUnique({
        where: { id: seat.orgId },
        select: { name: true, marketCode: true },
      })
    : null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      passwordHash: true,
      mfaEnabledAt: true,
    },
  });
  if (!user) redirect(`/${locale}/signin`);

  const t = await getTranslations({ locale, namespace: "account" });
  const tMarket = await getTranslations({ locale, namespace: "market" });
  const tMfa = await getTranslations({ locale, namespace: "mfa" });

  // Banner copy comes from a lookup table (@/lib/account-messages), not the
  // ternary chain that used to live here — that chain had no branch for six of
  // the codes the actions actually emit, so those failures showed the user
  // nothing at all. Unknown error codes now fall back to a generic message.
  const okKey = accountOkKey(typeof sp.ok === "string" ? sp.ok : undefined);
  const errKey = accountErrorKey(
    typeof sp.error === "string" ? sp.error : undefined,
  );
  const okMessage = okKey ? t(okKey) : null;
  const errMessage = errKey ? t(errKey) : null;
  const errFieldId = accountErrorFieldId(typeof sp.error === "string" ? sp.error : undefined);

  return (
    <>
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      {okMessage ? (
        <div className="banner-info" role="status">
          <span>{okMessage}</span>
        </div>
      ) : null}
      {errMessage ? (
        <div className="banner-error" role="alert" id="account-error">
          <span>{errMessage}</span>
        </div>
      ) : null}
      {errMessage && errFieldId ? (
        <FieldErrorLink fieldId={errFieldId} describedBy="account-error" />
      ) : null}

      <section className="section" id="profile">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("profileEyebrow")}</span>
            <h2>{t("profileTitle")}</h2>
          </div>
        </div>
        <ProfileForm
          locale={locale}
          email={user.email}
          name={user.name ?? ""}
          phone={user.phone ?? ""}
        />
      </section>

      <section className="section" id="language">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("languageEyebrow")}</span>
            <h2>{t("languageTitle")}</h2>
          </div>
        </div>
        <div className="product-form card">
          <div className="field">
            <label htmlFor="acc-language">{t("languageLabel")}</label>
            <LocaleSwitcher current={locale} />
            <span className="hint">{t("languageHint")}</span>
          </div>
        </div>
      </section>

      {/* Sign-in email. The address moves only when the link sent to the NEW
          mailbox is clicked — see @/app/account-email-actions. Password
          holders re-authenticate here; magic-link-only accounts can't, so for
          them the confirmation link is the whole gate. */}
      <section className="section" id="email">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("emailEyebrow")}</span>
            <h2>{t("emailTitle")}</h2>
          </div>
        </div>
        <EmailChangeForm locale={locale} hasPassword={!!user.passwordHash} />
      </section>

      {/* Desk, publisher and writer accounts have no organisation of their
          own — updateCompany refuses for them, so rendering an empty,
          permanently-disabled company card was pure confusion. */}
      {company ? (
      <section className="section" id="company">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("companyEyebrow")}</span>
            <h2>{t("companyTitle")}</h2>
          </div>
        </div>
        <form action={updateCompany} className="product-form card">
          <input type="hidden" name="locale" value={locale} />
          <div className="field">
            <label htmlFor="acc-org">{t("orgLabel")}</label>
            <input
              id="acc-org"
              name="orgName"
              autoComplete="organization"
              required
              disabled={!isOrgAdmin}
              defaultValue={company.name}
            />
          </div>
          <div className="field">
            <label htmlFor="acc-market">{t("marketLabel")}</label>
            <select
              id="acc-market"
              name="market"
              defaultValue={company.marketCode ?? ""}
              required
              disabled={!isOrgAdmin}
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
          {isOrgAdmin && (
            <div className="actions">
              <SubmitButton
                label={t("saveCompany")}
                pendingLabel={t("saving")}
              />
            </div>
          )}
        </form>
      </section>
      ) : null}

      <section className="section" id="password">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("passwordEyebrow")}</span>
            <h2>
              {user.passwordHash ? t("passwordTitleChange") : t("passwordTitleSet")}
            </h2>
          </div>
        </div>
        <PasswordForm locale={locale} hasPassword={!!user.passwordHash} />
      </section>

      {/* Two-factor lives on its own page (/account/security): staff are sent
          straight there when MFA_REQUIRED_FOR_STAFF is on. */}
      <section className="section" id="two-factor">
        <div className="section-head">
          <div>
            <span className="eyebrow">{tMfa("eyebrow")}</span>
            <h2>{tMfa("accountSectionTitle")}</h2>
          </div>
        </div>
        <div className="product-form card">
          <p>
            {user.mfaEnabledAt
              ? tMfa("accountSectionBodyOn")
              : tMfa("accountSectionBodyOff")}
          </p>
          <div className="actions">
            <Link href="/account/security" className="btn secondary">
              {tMfa("manage")}
            </Link>
          </div>
        </div>
      </section>

      {ws?.activeOrgId && (
        <TeamSection
          locale={locale}
          orgId={ws.activeOrgId}
          isAdmin={ws.activeRole === "ADMIN"}
        />
      )}

      <NotificationPrefsSection locale={locale} userId={user.id} saved={sp.prefs === "saved"} />

      {/* Data & account. The export endpoint has existed since the GDPR work
          landed but nothing linked to it, so in practice no user could reach
          it. A plain <a> rather than a form: it's a GET that streams JSON. */}
      <section className="section" id="data">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("dataEyebrow")}</span>
            <h2>{t("dataTitle")}</h2>
          </div>
        </div>
        <div className="product-form card">
          <div className="field">
            <label>{t("exportLabel")}</label>
            <p className="muted small">
              {ws ? t("exportHint") : t("exportNoOrgHint")}
            </p>
            {ws ? (
              <p>
                <a className="btn secondary" href="/api/export/me" download>
                  {t("exportButton")}
                </a>
              </p>
            ) : null}
          </div>
        </div>

        {/* Deactivation sits behind a disclosure + a typed confirmation, the
            same friction the desk's order-cancel control uses. It is the one
            control here the user cannot undo themselves. */}
        <details className="spec-details card" id="danger" style={{ marginTop: "1rem" }}>
          <summary>
            <span className="btn secondary block">{t("deactivateSummary")}</span>
          </summary>
          <DeactivateForm locale={locale} email={user.email} />
        </details>
      </section>
    </>
  );
}
