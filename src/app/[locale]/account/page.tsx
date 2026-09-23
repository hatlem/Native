import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadScope } from "@/lib/scope";
import {
  updateCompany,
  updateProfile,
  setPassword,
  deactivateOwnAccount,
} from "@/app/account-actions";
import { requestEmailChange } from "@/app/account-email-actions";
import { accountOkKey, accountErrorKey } from "@/lib/account-messages";
import { SubmitButton } from "@/components";
import { TeamSection } from "./team-section";
import { LocaleSwitcher } from "./locale-switcher";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);

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
// users get the standard nav around it. Banner messages on success
// or per-field error keyed by ?ok= / ?error= query params + anchor.
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
  // Company info is admin-only to edit (server-enforced in updateCompany);
  // non-admin seats see it read-only.
  const isOrgAdmin = ws?.activeRole === "ADMIN";

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      passwordHash: true,
      organization: { select: { name: true, marketCode: true } },
    },
  });
  if (!user) redirect(`/${locale}/signin`);

  const t = await getTranslations({ locale, namespace: "account" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

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
        <div className="banner-error" role="alert">
          <span>{errMessage}</span>
        </div>
      ) : null}

      <section className="section" id="profile">
        <div className="section-head">
          <div>
            <span className="eyebrow">{t("profileEyebrow")}</span>
            <h2>{t("profileTitle")}</h2>
          </div>
        </div>
        <form action={updateProfile} className="product-form card">
          <input type="hidden" name="locale" value={locale} />
          <div className="field">
            <label htmlFor="acc-email">{t("emailLabel")}</label>
            <input id="acc-email" type="email" value={user.email} disabled readOnly />
            <span className="hint">{t("emailHint")}</span>
          </div>
          <div className="field">
            <label htmlFor="acc-name">
              {t("nameLabel")}{" "}
              <span className="optional">({t("optional")})</span>
            </label>
            <input
              id="acc-name"
              name="name"
              autoComplete="name"
              defaultValue={user.name ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="acc-phone">{t("phoneLabel")}</label>
            <input
              id="acc-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              defaultValue={user.phone ?? ""}
              placeholder="+47 ..."
            />
            <span className="hint">{t("phoneHint")}</span>
          </div>
          <div className="actions">
            <SubmitButton
              label={t("saveProfile")}
              pendingLabel={t("saving")}
            />
          </div>
        </form>
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
        <form action={requestEmailChange} className="product-form card">
          <input type="hidden" name="locale" value={locale} />
          <div className="field">
            <label htmlFor="acc-new-email">{t("newEmailLabel")}</label>
            <input
              id="acc-new-email"
              name="newEmail"
              type="email"
              autoComplete="email"
              required
              placeholder={t("newEmailPlaceholder")}
            />
            <span className="hint">{t("emailChangeHint")}</span>
          </div>
          {user.passwordHash ? (
            <div className="field">
              <label htmlFor="acc-email-pw">{t("currentPasswordLabel")}</label>
              <input
                id="acc-email-pw"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
          ) : null}
          <div className="actions">
            <SubmitButton
              label={t("saveEmail")}
              pendingLabel={t("saving")}
            />
          </div>
        </form>
      </section>

      {/* Desk, publisher and writer accounts have no organisation of their
          own — updateCompany refuses for them, so rendering an empty,
          permanently-disabled company card was pure confusion. */}
      {user.organization ? (
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
              defaultValue={user.organization?.name ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="acc-market">{t("marketLabel")}</label>
            <select
              id="acc-market"
              name="market"
              defaultValue={user.organization?.marketCode ?? ""}
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
        <form action={setPassword} className="product-form card">
          <input type="hidden" name="locale" value={locale} />
          {user.passwordHash ? (
            <div className="field">
              <label htmlFor="acc-pw-current">{t("currentPasswordLabel")}</label>
              <input
                id="acc-pw-current"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
          ) : (
            <p className="muted small">{t("passwordlessNote")}</p>
          )}
          <div className="field">
            <label htmlFor="acc-pw-new">{t("newPasswordLabel")}</label>
            <input
              id="acc-pw-new"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <span className="hint">{t("pwHint")}</span>
          </div>
          <div className="actions">
            <SubmitButton
              label={user.passwordHash ? t("savePasswordChange") : t("savePasswordSet")}
              pendingLabel={t("saving")}
            />
          </div>
        </form>
      </section>

      {ws?.activeOrgId && (
        <TeamSection
          locale={locale}
          orgId={ws.activeOrgId}
          isAdmin={ws.activeRole === "ADMIN"}
        />
      )}

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
          <form action={deactivateOwnAccount} className="product-form">
            <input type="hidden" name="locale" value={locale} />
            <h3 style={{ margin: "12px 0 4px" }}>{t("deactivateTitle")}</h3>
            <p className="muted small">{t("deactivateHint")}</p>
            <div className="field">
              <label htmlFor="acc-deactivate-confirm">
                {t("deactivateConfirmLabel")}
              </label>
              <input
                id="acc-deactivate-confirm"
                name="confirmEmail"
                type="email"
                autoComplete="off"
                required
                placeholder={user.email}
              />
            </div>
            <div className="actions">
              <SubmitButton
                label={t("deactivateButton")}
                pendingLabel={t("deactivating")}
                className="btn danger block"
              />
            </div>
          </form>
        </details>
      </section>
    </>
  );
}
