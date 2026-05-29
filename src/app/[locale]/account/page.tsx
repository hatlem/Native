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
} from "@/app/account-actions";
import { SubmitButton } from "@/components";
import { TeamSection } from "./team-section";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);

// Authenticated-user account/profile page. Three sections, each
// scoped to its own form + server action:
//   - Profile (name, phone)
//   - Company (org name + billing market)
//   - Password (set or change)
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

  const okCode = typeof sp.ok === "string" ? sp.ok : undefined;
  const errCode = typeof sp.error === "string" ? sp.error : undefined;
  const okMessage = okCode === "profile"
    ? t("okProfile")
    : okCode === "company"
      ? t("okCompany")
      : okCode === "password"
        ? t("okPassword")
        : okCode === "invited"
          ? t("okInvited")
          : okCode === "revoked"
            ? t("okRevoked")
            : okCode === "updated"
              ? t("okUpdated")
              : okCode === "invite_revoked"
                ? t("okInviteRevoked")
                : okCode === "joined"
                  ? t("okJoined")
                  : null;
  const errMessage = errCode === "phone"
    ? t("errPhone")
    : errCode === "company"
      ? t("errCompany")
      : errCode === "password_length"
        ? t("errPasswordLength")
        : errCode === "current_password"
          ? t("errCurrentPassword")
          : errCode === "forbidden"
            ? t("errForbidden")
            : errCode === "last_admin"
              ? t("errLastAdmin")
              : errCode === "already_member"
                ? t("errAlreadyMember")
                : null;

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
            <input id="acc-email" type="email" value={user.email} disabled />
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
          <div className="actions">
            <SubmitButton
              label={t("saveCompany")}
              pendingLabel={t("saving")}
            />
          </div>
        </form>
      </section>

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
    </>
  );
}
