import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { MarketCode } from "@prisma/client";
import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { register } from "@/app/auth-actions";

export const dynamic = "force-dynamic";

const MARKET_CODES = Object.values(MarketCode);

export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (session?.user) redirect(`/${locale}/catalog`);

  const t = await getTranslations({ locale, namespace: "auth" });
  const tMarket = await getTranslations({ locale, namespace: "market" });

  return (
    <section>
      <h1>{t("signupTitle")}</h1>
      {sp.error === "exists" ? (
        <p className="note">{t("regExists")}</p>
      ) : sp.error ? (
        <p className="note">{t("regFailed")}</p>
      ) : null}
      <form action={register} className="filters">
        <input type="hidden" name="locale" value={locale} />
        <div>
          <label htmlFor="name">{t("name")}</label>
          <input id="name" name="name" />
        </div>
        <div>
          <label htmlFor="orgName">{t("org")}</label>
          <input id="orgName" name="orgName" required />
        </div>
        <div>
          <label htmlFor="market">{t("market")}</label>
          <select id="market" name="market" defaultValue="">
            <option value="" disabled>
              —
            </option>
            {MARKET_CODES.map((m) => (
              <option key={m} value={m}>
                {tMarket(m)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="email">{t("email")}</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div>
          <label htmlFor="password">{t("password")}</label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={8}
            required
          />
        </div>
        <button type="submit">{t("createAccount")}</button>
      </form>
      <p className="note">{t("pwHint")}</p>
      <p className="note">
        {t("haveAccount")} <Link href="/signin">{t("signin")}</Link>
      </p>
    </section>
  );
}
