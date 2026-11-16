"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
// Not the @/components barrel: it also pulls in ExtraWorkForm, whose zod
// schemas are built on import and trip the CSP (zod probes eval).
import { GetTalkBooking } from "@/components/get-talk-booking";
import { dismissBookingPrompt } from "@/app/booking-prompt-actions";

export function CatalogBookCallBanner() {
  const t = useTranslations("catalog");
  const [hidden, setHidden] = useState(false);

  const dismiss = () => {
    setHidden(true); // optimistic
    void dismissBookingPrompt();
  };

  // The embed fires this on a completed booking — treat it as a dismissal so
  // the nudge never returns once they've actually booked. No server webhook needed.
  useEffect(() => {
    const onBooked = () => dismiss();
    document.addEventListener("gettalk:booking:complete", onBooked);
    return () => document.removeEventListener("gettalk:booking:complete", onBooked);
  }, []);

  if (hidden) return null;

  return (
    <div className="book-call-banner" role="note">
      <div>
        <strong>{t("bookCallTitle")}</strong>
        <p className="muted">{t("bookCallBody")}</p>
      </div>
      <div className="book-call-banner-actions">
        <GetTalkBooking mode="popup" text={t("bookCallCta")} />
        <button
          type="button"
          className="book-call-banner-dismiss"
          aria-label={t("bookCallDismiss")}
          onClick={dismiss}
        >
          ×
        </button>
      </div>
    </div>
  );
}
