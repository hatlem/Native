// Namespace import so the JSX below also compiles under the classic runtime
// (the node:test runner transpiles this file outside Next's automatic runtime).
import * as React from "react";
import { Fragment, type ReactNode } from "react";

// Cloudflare's Email Address Obfuscation rewrites anything that LOOKS like an
// email in SSR text nodes into a `__cf_email__` placeholder + a decode script
// our CSP blocks — which breaks React hydration (#418) and leaves crawlers
// and no-JS visitors with "[email protected]". See mail-link.tsx for the
// mailto:-href half of the same fight.
//
// SafeEmail renders the address as three adjacent JSX expressions. React's
// SSR emits `local<!-- -->@<!-- -->domain` — Cloudflare's rewriter never
// matches across comment nodes, while textContent (copy/paste, a11y, search
// engines) still reads as the plain address.

export function SafeEmail({ address }: { address: string }) {
  const at = address.indexOf("@");
  if (at === -1) return <>{address}</>;
  return (
    <>
      {address.slice(0, at)}
      {"@"}
      {address.slice(at + 1)}
    </>
  );
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

// For translated copy that embeds an address in running text
// (e.g. "Drop a line to hello@nativespin.com and …"): splits the string and
// routes each email through SafeEmail so the surrounding prose stays a plain
// string for next-intl.
export function withSafeEmails(text: string): ReactNode {
  const matches = [...text.matchAll(EMAIL_RE)];
  if (matches.length === 0) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    const start = m.index;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<SafeEmail address={m[0]} key={`em-${i}`} />);
    cursor = start + m[0].length;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <Fragment>{parts}</Fragment>;
}
