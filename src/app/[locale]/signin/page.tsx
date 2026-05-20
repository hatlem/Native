import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { landingForRole } from "@/lib/roles";
import { authenticate } from "@/app/auth-actions";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (session?.user) redirect(landingForRole(session.user.role, locale));

  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <section>
      <h1>{t("title")}</h1>
      {sp.error ? <p className="note">{t("failed")}</p> : null}
      <form action={authenticate} className="filters">
        <input type="hidden" name="locale" value={locale} />
        <div>
          <label htmlFor="email">{t("email")}</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div>
          <label htmlFor="password">{t("password")}</label>
          <input id="password" name="password" type="password" required />
        </div>
        <button type="submit">{t("submit")}</button>
      </form>
      <p className="note">{t("hint")}</p>
      <p className="note">
        {t("noAccount")} <Link href="/signup">{t("signup")}</Link>
      </p>
    </section>
  );
}
