import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "no", "sv", "da"],
  defaultLocale: "en",
});

export type AppLocale = (typeof routing.locales)[number];
