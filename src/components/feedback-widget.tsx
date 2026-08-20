"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { FeedbackForm } from "@/components/feedback-form";

export function FeedbackWidget() {
  const t = useTranslations("common.feedback");
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  function openWidget() {
    setSent(false);
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label={t("sendFeedback")}
        title={t("sendFeedback")}
        onClick={openWidget}
      >
        <FeedbackIcon />
      </button>
      {open ? (
        <div className="cmdk-overlay" onClick={() => setOpen(false)}>
          <div
            className="cmdk-panel feedback-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("title")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="feedback-panel-head">
              <h2>{t("title")}</h2>
              <button type="button" className="icon-btn" aria-label={t("close")} onClick={() => setOpen(false)}>
                <CloseIcon />
              </button>
            </div>
            {sent ? (
              <div className="feedback-thanks">{t("thankYou")}</div>
            ) : (
              <FeedbackForm
                initialPageUrl={typeof window !== "undefined" ? window.location.href : ""}
                onSuccess={() => setSent(true)}
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function FeedbackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
