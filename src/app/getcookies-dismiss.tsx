"use client";

import { useEffect } from "react";
import { BANNER_CLOSE_SELECTOR, dismissalCategories, type GetCookiesApi } from "@/lib/consent-dismiss";

export function GetCookiesDismissAsReject() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Element) || !target.closest(BANNER_CLOSE_SELECTOR)) return;
      const api = (window as { GetCookies?: GetCookiesApi }).GetCookies;
      const categories = dismissalCategories(api);
      if (!categories) return;
      void Promise.resolve()
        .then(() => api?.updateConsent?.(categories))
        .catch(() => undefined);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
