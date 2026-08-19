import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "no", "sv", "da", "de", "fi"],
  defaultLocale: "en",
});

export type AppLocale = (typeof routing.locales)[number];

// Coerce an untrusted locale (form field, route param) to a known locale,
// defaulting to `en`. Use this before interpolating a locale into a
// redirect/link path in an unauthenticated action, so a value like
// "/evil.com" can never produce a protocol-relative `//evil.com/...` URL.
export function safeLocale(value: unknown): AppLocale {
  return (routing.locales as readonly string[]).includes(value as string)
    ? (value as AppLocale)
    : routing.defaultLocale;
}
