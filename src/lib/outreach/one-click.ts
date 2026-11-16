// RFC 8058 one-click unsubscribe for outreach mail.
//
// Outreach emails carry `List-Unsubscribe: <url>` with
// `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. A mailbox provider's
// own "Unsubscribe" button then POSTs to that URL and expects a plain 2xx —
// no page, no redirect, no session. The URL in the header is the same opt-out
// page the email body links to (/<locale>/rate-card/<token>/unsubscribe or
// /<locale>/price-request/<token>/unsubscribe), which only answers GET, so
// the middleware hands such a POST to /api/outreach/unsubscribe instead.
//
// Pure module (imported by the middleware): no DB, no Node APIs.

export type OneClickKind = "rate-card" | "price-request";

const PAGE_PATH = /^\/[a-z]{2}\/(rate-card|price-request)\/([^/]+)\/unsubscribe\/?$/;

export const ONE_CLICK_API_PATH = "/api/outreach/unsubscribe";
// How the middleware tells the API route which request a rewritten POST
// stands for (a rewritten handler keeps the original URL's query string).
export const ONE_CLICK_KIND_HEADER = "x-one-click-kind";
export const ONE_CLICK_TOKEN_HEADER = "x-one-click-token";

// The request a one-click POST to an opt-out page stands for, or null when
// it is anything else (a GET page view, or a server-action POST — those
// carry a `next-action` header and must reach the page untouched).
export function oneClickUnsubscribeTarget(input: {
  method: string;
  pathname: string;
  isServerAction: boolean;
}): { kind: OneClickKind; token: string } | null {
  if (input.method !== "POST" || input.isServerAction) return null;
  const m = input.pathname.match(PAGE_PATH);
  if (!m) return null;
  let token: string;
  try {
    token = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  return { kind: m[1] as OneClickKind, token };
}

export function oneClickApiPath(target: { kind: OneClickKind; token: string }): string {
  return `${ONE_CLICK_API_PATH}?kind=${target.kind}&token=${encodeURIComponent(target.token)}`;
}

export function isOneClickKind(value: string | null): value is OneClickKind {
  return value === "rate-card" || value === "price-request";
}
