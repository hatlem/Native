import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LandingShell } from "@/app/landing-shell";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return {
    title: t("checkTitle"),
    // One-off, token- or flow-bound page: nothing to index.
    robots: { index: false, follow: false },
  };
}

export default async function CheckEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "auth" });

  // ?verify=1 marks the "you tried to sign in but your account isn't
  // verified yet — we just resent the link" case. Same page chrome,
  // different copy so the user knows the email they just received is
  // a fresh send, not the original signup one.
  const verifyResend = sp.verify === "1";
  // ?signup=1 follows the signup form. "If that email is registered…" reads
  // oddly straight after creating an account, so this variant says what
  // actually happens — including for an address that already had an
  // account, which gets a sign-in mail instead (same page either way, so the
  // page itself reveals nothing about which one it was).
  const afterSignup = sp.signup === "1";
  const title = verifyResend
    ? t("checkVerifyTitle")
    : afterSignup
      ? t("checkSignupTitle")
      : t("checkTitle");
  const lead = verifyResend
    ? t("checkVerifyLead")
    : afterSignup
      ? t("checkSignupLead")
      : t("checkLead");

  return (
    <LandingShell locale={locale} screenLabel="Check email">
      <section className="auth-shell">
        <div className="auth-card" style={{ maxWidth: 440 }}>
          <div className="head">
            <h2>{title}</h2>
            <p>{lead}</p>
          </div>
          <div className="alt">
            <Link href="/signin">{t("backToSignin")}</Link>
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
