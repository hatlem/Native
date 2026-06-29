"use client";

import { useEffect, useId, useRef } from "react";
import { MailLink } from "./mail-link";

const HANDLE = process.env.NEXT_PUBLIC_GETTALK_USERNAME;
const DESK_EMAIL = "desk@nativespin.com";

export function resolveBookingFallbackHref(handle: string | undefined): string {
  return handle ? `https://gettalk.co/${handle}` : `mailto:${DESK_EMAIL}`;
}

// Injects GetTalk's embed.js into a container we own. embed.js reads the
// script's data-* attributes and renders into data-container. We always also
// render a fallback so booking is reachable even if the script is blocked
// (CSP/network) or the handle is unset.
//
// When the handle is unset we render <MailLink> rather than a raw
// <a href="mailto:…"> because Cloudflare's email-address obfuscation rewrites
// every mailto: in SSR HTML into a /cdn-cgi/l/email-protection URL and injects
// email-decode.min.js — our CSP blocks that script, leaving a half-rewritten
// DOM that React's hydration can't reconcile (Minified React error #418).
export function GetTalkBooking({
  mode,
  text,
}: {
  mode: "inline" | "popup";
  text?: string;
}) {
  const rawId = useId();
  const containerId = `gettalk-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!HANDLE || !ref.current) return;
    const script = document.createElement("script");
    script.src = "https://gettalk.co/embed.js";
    script.async = true;
    script.setAttribute("data-username", HANDLE);
    script.setAttribute("data-mode", mode);
    script.setAttribute("data-container", containerId);
    if (text) script.setAttribute("data-text", text);
    document.body.appendChild(script);
    const container = ref.current;
    return () => {
      script.remove();
      if (container) container.innerHTML = "";
    };
  }, [mode, text, containerId]);

  if (!HANDLE) {
    // No embed handle configured — render a MailLink fallback so the CTA is
    // still functional without putting mailto: in SSR HTML.
    return (
      <div className="gettalk-booking">
        <MailLink to={DESK_EMAIL} className="btn primary">
          {text ?? "Book a call"}
        </MailLink>
      </div>
    );
  }

  const fallbackHref = resolveBookingFallbackHref(HANDLE);

  return (
    <div className="gettalk-booking">
      <div id={containerId} ref={ref} />
      <a
        href={fallbackHref}
        className="gettalk-booking-fallback"
        target="_blank"
        rel="noreferrer"
      >
        {text ?? "Book a call"}
      </a>
    </div>
  );
}
