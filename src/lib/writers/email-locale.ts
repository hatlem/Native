import type { ContentLanguage, LanguageProficiency } from "@prisma/client";

export type EmailLocale = "en" | "no" | "sv" | "da" | "fi" | "de";

const LANGUAGE_LOCALE: Record<ContentLanguage, EmailLocale> = {
  NO: "no",
  SV: "sv",
  DA: "da",
  FI: "fi",
  DE: "de",
  EN: "en",
};

export function localeForContentLanguage(language: ContentLanguage): EmailLocale {
  return LANGUAGE_LOCALE[language];
}

// Which language to email a writer in. Users have no stored UI locale, so
// the writer profile is the best signal we have:
//   1. the language of the content they're being asked to write, when
//      their profile lists it (they read it well enough to write in it);
//   2. otherwise their native language (first by the enum's order, so the
//      pick is deterministic);
//   3. otherwise their only listed language;
//   4. otherwise English.
export function writerEmailLocale(args: {
  languages: { language: ContentLanguage; proficiency: LanguageProficiency | null }[];
  contentLanguage?: ContentLanguage | null;
}): EmailLocale {
  const { languages, contentLanguage } = args;
  if (contentLanguage && languages.some((l) => l.language === contentLanguage)) {
    return LANGUAGE_LOCALE[contentLanguage];
  }
  const order = Object.keys(LANGUAGE_LOCALE) as ContentLanguage[];
  const native = languages
    .filter((l) => l.proficiency === "NATIVE")
    .sort((a, b) => order.indexOf(a.language) - order.indexOf(b.language))[0];
  if (native) return LANGUAGE_LOCALE[native.language];
  if (languages.length === 1) return LANGUAGE_LOCALE[languages[0].language];
  return "en";
}

const EMAIL_LOCALES: readonly EmailLocale[] = ["en", "no", "sv", "da", "fi", "de"];

export function asEmailLocale(value: string | null | undefined): EmailLocale | null {
  return EMAIL_LOCALES.includes(value as EmailLocale) ? (value as EmailLocale) : null;
}
