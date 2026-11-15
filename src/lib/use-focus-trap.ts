"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Modal focus management for a custom dialog (WCAG 2.4.3 / 2.1.2):
//  - on open, move focus into the container (unless it is already inside),
//  - keep Tab / Shift+Tab cycling within it,
//  - on close, return focus to whatever opened it.
export function useFocusTrap(ref: RefObject<HTMLElement | null>, open: boolean) {
  // What had focus before the dialog opened. Tracked while closed, because by
  // the time the open effect runs a child with autoFocus may already have
  // taken focus inside the dialog.
  const lastOutside = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return;
    const remember = () => {
      const el = document.activeElement as HTMLElement | null;
      // The dialog's own autoFocus fires before this listener is removed —
      // and before the container ref is attached — so recognise "inside a
      // modal" from the DOM rather than from the ref.
      if (el && !el.closest('[aria-modal="true"]')) lastOutside.current = el;
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const container = ref.current;
    if (!container) return;
    const active = document.activeElement as HTMLElement | null;
    const opener = active && !container.contains(active) && active !== document.body ? active : lastOutside.current;

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.tabIndex >= 0 && (el.offsetParent !== null || el === document.activeElement),
      );

    if (!container.contains(document.activeElement)) {
      (focusables()[0] ?? container).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      // Tab order is managed here entirely rather than left to the browser:
      // a scrollable region or anything else the browser considers tabbable
      // must not become a way out of the dialog.
      e.preventDefault();
      const items = focusables();
      if (items.length === 0) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? i <= 0
          ? items.length - 1
          : i - 1
        : i === -1 || i === items.length - 1
          ? 0
          : i + 1;
      items[next].focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [ref, open]);
}
