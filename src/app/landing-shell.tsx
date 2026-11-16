import type { ReactNode } from "react";
import { inter2 as inter } from "@/fonts";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BrandWordmark } from "@/app/brand";
import { MailLink } from "@/components";
import { NewsletterSignup } from "@/app/[locale]/(marketing)/_components/NewsletterSignup";
import { STYLES_HREF } from "./landing-styles";

const DESK_SUBJECT = "Talk to the NativeSpin desk";

const MARKETS = ["no", "se", "dk", "fi", "de", "at", "ch", "uk", "ie"] as const;

type LandingShellProps = {
  locale: string;
  /** Optional screen label rendered as `data-screen-label` for QA/debug tooling. */
  screenLabel?: string;
  /** When false, the shell omits the shared `.page-foot` (homepage already renders its own). */
  withFooter?: boolean;
  /** Optional extra classes appended to the `.bn` root (e.g. `legal-doc`). */
  rootClassName?: string;
  children: ReactNode;
};

export async function LandingShell({
  locale,
  screenLabel,
  withFooter = true,
  rootClassName,
  children,
}: LandingShellProps) {
  const t = await getTranslations({ locale, namespace: "landing" });

  const rootClass = ["bn", inter.variable, withFooter ? null : "bn--bare", rootClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} data-screen-label={screenLabel}>
      {/* A linked, hashed stylesheet (app/landing.css): cached by the browser
          instead of inlined into every response. `precedence` makes React
          hoist it into <head>, de-duplicate it and hold the first paint until
          it has loaded, so there is no unstyled flash. */}
      <link rel="stylesheet" href={STYLES_HREF} precedence="landing" />
      {children}
      {withFooter ? (
        <footer className="page-foot">
          <div className="wrap">
            <div className="foot-top">
              <div className="foot-newsletter">
                <div className="copy">{t("newsletter.footerHeading")}</div>
                <NewsletterSignup variant="compact" source="footer" />
              </div>
              <nav aria-label="Footer">
                <div className="foot-nav-col">
                  <Link href="/for-advertisers">{t("foot.navAdv")}</Link>
                  <Link href="/for-agencies">{t("foot.navAgy")}</Link>
                  <Link href="/about">{t("foot.navAbout")}</Link>
                </div>
                <div className="foot-nav-col">
                  <Link href="/for-publishers">{t("foot.navPub")}</Link>
                  <Link href="/resources/creative-specs">{t("foot.navCreativeSpecs")}</Link>
                  <MailLink to="desk@nativespin.com" subject={DESK_SUBJECT}>
                    {t("foot.navContact")}
                  </MailLink>
                </div>
              </nav>
            </div>
            <div className="brand-foot-block">
              <BrandWordmark className="brand-foot-mark" aria-label="NativeSpin" />
              <div className="copy">{t("foot.tagline")}</div>
            </div>
            <div className="foot-legal">
              <div className="copy">
                © <span className="roman">MMXXVI</span> · {t("foot.copy")}
              </div>
              <div className="markets">
                {MARKETS.map((m) => m.toUpperCase()).join(" · ")}
              </div>
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
