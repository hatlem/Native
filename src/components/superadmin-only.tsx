import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { MailLink } from "./mail-link";

type Props = {
  locale: string;
  // The page's own localized name ("Users", "Price quotes"), so the denied
  // state says which page the visitor reached, not a generic "restricted".
  area: string;
  // Optional page-specific explanation; the generic body is used otherwise.
  body?: string;
};

// The one permission-denied state every SUPERADMIN-only desk page renders
// for a signed-in user without that role (pair with superadminPageGate in
// @/lib/desk-guard). Keeping it in one component means every restricted
// page explains itself the same way and points to the same way out.
export async function SuperadminOnly({ locale, area, body }: Props) {
  const t = await getTranslations({ locale, namespace: "superadminOnly" });
  return (
    <section className="section">
      <header className="page-header">
        <span className="eyebrow accent">{t("eyebrow")}</span>
        <h1>{area}</h1>
        <p className="lead">{t("lead")}</p>
      </header>
      <div className="card">
        <p>{body ?? t("body")}</p>
        <p className="cluster" style={{ marginTop: 16 }}>
          <MailLink
            to="desk@nativespin.com"
            subject={t("mailSubject", { area })}
            className="btn small secondary"
          >
            {t("cta")}
          </MailLink>
          <Link href="/desk" className="btn small ghost">
            {t("back")}
          </Link>
        </p>
      </div>
    </section>
  );
}
