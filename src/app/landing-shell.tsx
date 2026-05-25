import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { STYLES } from "./landing-styles";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600"],
});

const DESK_MAILTO =
  "mailto:desk@atnative.com?subject=Talk%20to%20the%20ATNative%20desk";

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
  // Per-request CSP nonce minted by middleware.ts. The strict policy would
  // otherwise block the inline <style> block below.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const t = await getTranslations({ locale, namespace: "landing" });

  const rootClass = ["bn", inter.variable, rootClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} data-screen-label={screenLabel}>
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: STYLES }} />
      {children}
      {withFooter ? (
        <footer className="page-foot">
          <div className="wrap">
            <div className="left">
              <div className="brand-foot">ATNative</div>
              <div className="copy">{t("foot.tagline")}</div>
              <div className="copy" style={{ marginTop: 8 }}>
                © <span className="roman">MMXXVI</span> · {t("foot.copy")}
              </div>
            </div>
            <nav aria-label="Footer">
              <Link href="/for-advertisers">{t("foot.navAdv")}</Link>
              <Link href="/for-agencies">{t("foot.navAgy")}</Link>
              <Link href="/for-publishers">{t("foot.navPub")}</Link>
              <Link href="/about">{t("foot.navAbout")}</Link>
              <a href={DESK_MAILTO}>{t("foot.navContact")}</a>
            </nav>
            <div className="markets">
              {MARKETS.map((m) => (
                <span key={m}>
                  <span className={`flag ${m}`}></span>
                  {m.toUpperCase()}
                </span>
              ))}
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
