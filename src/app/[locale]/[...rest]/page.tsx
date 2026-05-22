import { notFound } from "next/navigation";

// Catch-all that forwards unmatched [locale] routes to the localized
// not-found.tsx so users see the BeNative 404, not the default Next.js
// fallback (which renders without the locale layout, brand or footer).
export default function CatchAllNotFound() {
  notFound();
}
