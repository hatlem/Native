"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

// Pushes a single dataLayer event for a conversion, deduped per id within
// the browser session so re-viewing the page doesn't double-count.
export function DataLayerEvent({
  event,
  id,
  value,
  currency,
}: {
  event: string;
  id: string;
  value?: number;
  currency?: string;
}) {
  useEffect(() => {
    const key = `gtm:${event}:${id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, id, value, currency });
  }, [event, id, value, currency]);
  return null;
}
