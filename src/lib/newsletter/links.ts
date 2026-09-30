import crypto from "node:crypto";
import { safeLocale, type AppLocale } from "@/i18n/routing";

// Newsletter link tokens and redirect locale.
//
// The unsubscribe token is DETERMINISTIC per address: an HMAC of the email
// under AUTH_SECRET. Its sha256 is what Subscriber.unsubTokenHash stores, so
// the existing hash lookup resolves it, and — unlike the random token this
// replaced, whose raw value was thrown away at creation — the same link can
// be minted again for every email we send. It survives confirmation and
// re-subscribes, which is the point: an opt-out link must keep working for
// as long as we keep mailing the address.
//
// Rotating AUTH_SECRET invalidates outstanding unsubscribe links (as it
// already invalidates every session); the next mail carries fresh ones.

const UNSUB_CONTEXT = "nativespin:newsletter-unsubscribe:v1:";

export function newsletterUnsubToken(
  email: string,
  secret: string = process.env.AUTH_SECRET ?? "",
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(UNSUB_CONTEXT + email.trim().toLowerCase())
    .digest("base64url");
}

export function newsletterLinks(args: {
  origin: string;
  confirmRaw: string;
  unsubRaw: string;
  locale: string;
}): { confirmUrl: string; unsubUrl: string } {
  // `lang` only steers the error page's language when the token itself
  // can't be resolved; a resolved token uses the subscriber's stored locale.
  const lang = encodeURIComponent(safeLocale(args.locale));
  return {
    confirmUrl: `${args.origin}/api/newsletter/confirm?token=${args.confirmRaw}&lang=${lang}`,
    unsubUrl: `${args.origin}/api/newsletter/unsubscribe?token=${args.unsubRaw}&lang=${lang}`,
  };
}

// Locale for a redirect when no subscriber row tells us better: the link's
// own `lang`, then the visitor's NEXT_LOCALE cookie, then the default. Never
// a hard-coded /en — a Norwegian subscriber clicking a stale link should
// read the explanation in Norwegian.
export function newsletterFallbackLocale(
  lang: string | null,
  cookieLocale: string | undefined,
): AppLocale {
  if (lang && safeLocale(lang) === lang) return lang as AppLocale;
  return safeLocale(cookieLocale);
}
