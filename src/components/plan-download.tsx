import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";

// "Download plan": the plan as PDF or Word, from /plan (for the team to pass
// around internally) and from the share page (for the client to keep). Plain
// <a download> links to route handlers that render on demand
// (lib/pdf/plan-download.ts), so there is no client JS and nothing stored.
// Server component (next-intl/server), so it is deliberately not in the
// @/components barrel, which client components import.
export async function PlanDownload({
  locale,
  basePath,
  variant,
  showLiveHint = false,
}: {
  locale: string;
  // The download route without its format: /api/export/plan/<listId> or
  // /api/export/shared-plan/<token>.
  basePath: string;
  variant: "plan" | "share";
  // /plan only, when the viewer can create the share link below it: point a
  // buyer about to send the file to a client at the live link instead.
  showLiveHint?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: variant === "plan" ? "plan.download" : "shareList.download" });
  const href = (format: "pdf" | "docx") => `${basePath}/${format}?locale=${encodeURIComponent(locale)}`;
  return (
    <section className="plan-download" aria-labelledby={`plan-download-${variant}`}>
      <h2 id={`plan-download-${variant}`} className="plan-download__heading">
        <Download size={15} strokeWidth={1.8} aria-hidden="true" />
        {t("heading")}
      </h2>
      <p className="muted small">{t("hint")}</p>
      <div className="plan-download__actions">
        <a className="btn small secondary" href={href("pdf")} download aria-label={t("pdfLabel")}>
          {t("pdf")}
        </a>
        <a className="btn small secondary" href={href("docx")} download aria-label={t("wordLabel")}>
          {t("word")}
        </a>
      </div>
      {variant === "plan" && showLiveHint ? <p className="muted small">{t("liveHint")}</p> : null}
    </section>
  );
}
