"use client";

import { useEffect } from "react";

// Ties the page's error banner to the input it is about: marks the input
// invalid, points aria-describedby at the banner and moves focus there, so a
// keyboard or screen-reader user lands on the field to fix with the reason
// announced. Renders nothing.
export function FieldErrorLink({ fieldId, describedBy }: { fieldId: string; describedBy: string }) {
  useEffect(() => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.setAttribute("aria-invalid", "true");
    const prev = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", prev ? `${prev} ${describedBy}` : describedBy);
    // A field inside a closed <details> can't take focus until it is open.
    el.closest("details")?.setAttribute("open", "");
    el.focus();
    return () => {
      el.removeAttribute("aria-invalid");
      if (prev) el.setAttribute("aria-describedby", prev);
      else el.removeAttribute("aria-describedby");
    };
  }, [fieldId, describedBy]);
  return null;
}
