"use client";

import { useEffect } from "react";

// The 404 page's tab title. Next resolves a not-found boundary's <head>
// from the layouts only — not-found.tsx can't export metadata, a page's
// generateMetadata is skipped once it calls notFound(), and a rendered
// <title> element is dropped from the HTML head. The only per-locale 404
// title Next leaves room for is the root global-not-found, which renders
// without the locale layout (no header, brand or footer). So the title is
// set after hydration. Crawlers lose nothing: a 404 is served with
// status 404 and noindex, which is what they act on.
export function NotFoundTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}
