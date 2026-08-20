"use client";

import { useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { useTranslations } from "next-intl";

type FeedbackType = "feedback" | "bug";
type SubmitState = "idle" | "sending" | "success" | "error";

export function FeedbackWidget() {
  const t = useTranslations("common.feedbackWidget");
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("feedback");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<SubmitState>("idle");

  const close = () => {
    setOpen(false);
    setState("idle");
  };

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          category: type,
          pageUrl: window.location.href,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setState("success");
      setMessage("");
      setType("feedback");
    } catch {
      setState("error");
    }
  };

  return (
    <>
      <button
        type="button"
        className="feedback-fab"
        onClick={() => setOpen(true)}
        title={t("buttonTitle")}
        aria-label={t("buttonTitle")}
      >
        <MessageSquare size={18} aria-hidden="true" />
      </button>

      {open ? (
        <div className="cmdk-overlay feedback-overlay" onClick={close}>
          <div
            className="cmdk-panel feedback-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("title")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="feedback-panel-head">
              <h2>{t("title")}</h2>
              <button
                type="button"
                className="btn ghost small"
                onClick={close}
                aria-label={t("close")}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {state === "success" ? (
              <div className="feedback-success">
                <p>{t("successMessage")}</p>
                <button type="button" className="btn secondary small" onClick={close}>
                  {t("close")}
                </button>
              </div>
            ) : (
              <div className="feedback-panel-body">
                <label htmlFor="feedback-type">{t("typeLabel")}</label>
                <select
                  id="feedback-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as FeedbackType)}
                  disabled={state === "sending"}
                >
                  <option value="feedback">{t("typeFeedback")}</option>
                  <option value="bug">{t("typeBug")}</option>
                </select>

                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t("placeholder")}
                  rows={5}
                  disabled={state === "sending"}
                  autoFocus
                />

                {state === "error" ? <p className="feedback-error">{t("errorFailed")}</p> : null}

                <div className="feedback-panel-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={handleSubmit}
                    disabled={state === "sending" || !message.trim()}
                  >
                    {state === "sending" ? t("sending") : t("sendFeedback")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
