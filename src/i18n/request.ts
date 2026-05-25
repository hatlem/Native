import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

const LANDING_SECTIONS = [
  "hero",
  "why",
  "vs",
  "rule",
  "pubs",
  "catalog",
  "stats",
  "how",
  "obj",
  "endCta",
  "foot",
] as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale =
    requested && (routing.locales as readonly string[]).includes(requested)
      ? requested
      : routing.defaultLocale;

  const base = (await import(`../messages/${locale}.json`)).default;

  const landingEntries = await Promise.all(
    LANDING_SECTIONS.map(async (section) => {
      const mod = await import(
        `../messages/landing/${locale}/${section}.json`
      );
      return [section, mod.default] as const;
    }),
  );

  return {
    locale,
    messages: {
      ...base,
      landing: Object.fromEntries(landingEntries),
    },
  };
});
