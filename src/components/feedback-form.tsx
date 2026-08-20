"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type FeedbackCategory = "feedback" | "bug";

export function FeedbackForm({
  initialPageUrl,
  onSuccess,
}: {
  initialPageUrl: string;
  onSuccess: () => void;
}) {
  const t = useTranslations("common.feedback");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) {
      setError(t("enterFeedback"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, category, pageUrl: initialPageUrl }),
      });
      if (!res.ok) throw new Error("failed");
      onSuccess();
    } catch {
      setError(t("sendFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="feedback-form" onSubmit={handleSubmit}>
      <div className="feedback-type" role="radiogroup" aria-label={t("typeLabel")}>
        <button
          type="button"
          className="feedback-type-btn"
          aria-pressed={category === "bug"}
          onClick={() => setCategory("bug")}
        >
          {t("typeBug")}
        </button>
        <button
          type="button"
          className="feedback-type-btn"
          aria-pressed={category === "feedback"}
          onClick={() => setCategory("feedback")}
        >
          {t("typeFeedback")}
        </button>
      </div>
      <textarea
        className="feedback-textarea"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t("placeholder")}
        rows={5}
        disabled={loading}
        autoFocus
      />
      {error ? <div className="feedback-error">{error}</div> : null}
      <div className="feedback-actions">
        <button type="submit" className="btn primary" disabled={loading || !message.trim()}>
          {loading ? t("sending") : t("send")}
        </button>
      </div>
    </form>
  );
}
