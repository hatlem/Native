"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// Marketing-route error boundary. Lives next to the marketing-group
// loading.tsx, so when a public page throws we still get the locale
// layout (header + footer) around a recognisable recovery surface.
// Falls back to globals.css .utility-page styling rather than the
// LandingShell-only Bone palette — the shell is a server component and
// can't be reached from a client error boundary.
export default function MarketingErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    if (typeof window !== "undefined") {
      console.error(error);
    }
  }, [error]);

  return (
    <div className="utility-page" role="alert">
      <span className="utility-code">!</span>
      <h1>{t("errorTitle")}</h1>
      <p className="lead">{t("errorBody")}</p>
      {error.digest ? (
        <p className="muted small">
          {t("errorRef")}: <code>{error.digest}</code>
        </p>
      ) : null}
      <div className="cluster">
        <button type="button" className="btn" onClick={reset}>
          {t("tryAgain")}
        </button>
        <Link href="/" className="btn secondary">
          {t("backHome")}
        </Link>
      </div>
    </div>
  );
}
