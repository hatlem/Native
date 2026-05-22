"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function ErrorBoundary({
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
    <div className="utility-page">
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
        <a href="/" className="btn secondary">
          {t("backHome")}
        </a>
      </div>
    </div>
  );
}
