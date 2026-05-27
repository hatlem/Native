"use client";

import { useState, useEffect } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

type Props = {
  to: string;
  subject?: string;
  body?: string;
  children?: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children">;

// Cloudflare's edge-level Email Address Obfuscation rewrites every
// `<a href="mailto:...">` in our SSR HTML into a `/cdn-cgi/l/email-protection`
// link plus an inline `email-decode.min.js` it expects to load on the client.
// Our CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`) blocks that script,
// leaving a half-rewritten DOM that React's hydration can't reconcile —
// surfacing as Minified React error #418 and a parentNode-null cascade across
// every Suspense boundary on the page. The simplest durable fix is to
// not ship a mailto: anchor in SSR HTML at all: render a clickable element
// during SSR with no email pattern, then attach the real mailto: only after
// mount, where Cloudflare's HTML rewriter can no longer reach it.
export function MailLink({ to, subject, body, children, ...rest }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // SSR + first client render — no `mailto:`, no `@` in href.
    // Anchor stays clickable; the onClick path below kicks in if a fast
    // user beats the effect by clicking before hydration finishes.
    return (
      <a
        {...rest}
        href="#"
        onClick={(e) => {
          e.preventDefault();
          window.location.href = buildMailto(to, subject, body);
        }}
      >
        {children ?? to}
      </a>
    );
  }

  return (
    <a {...rest} href={buildMailto(to, subject, body)}>
      {children ?? to}
    </a>
  );
}

function buildMailto(to: string, subject?: string, body?: string) {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const qs = params.toString();
  return `mailto:${to}${qs ? `?${qs}` : ""}`;
}
