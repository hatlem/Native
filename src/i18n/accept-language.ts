import { routing, type AppLocale } from "./routing";

// Accept-Language → app locale, for the few places that answer outside the
// next-intl middleware (API routes that redirect into a localized page).
// The middleware negotiates the same way for page requests; this keeps a
// route handler from sending a Norwegian browser to /en.
//
// Norwegian browsers send "nb" or "nn" (Bokmål / Nynorsk) far more often
// than the macro-language "no", and the app has one Norwegian locale.
const LANGUAGE_ALIASES: Readonly<Record<string, AppLocale>> = {
  nb: "no",
  nn: "no",
  no: "no",
};

function toAppLocale(tag: string): AppLocale | null {
  const primary = tag.trim().toLowerCase().split("-")[0];
  if (!primary || primary === "*") return null;
  const alias = LANGUAGE_ALIASES[primary];
  if (alias) return alias;
  return (routing.locales as readonly string[]).includes(primary) ? (primary as AppLocale) : null;
}

// The supported locale the browser prefers most, or null. Ranges are
// ordered by q (default 1; header order breaks ties); q=0 means "not this".
// Malformed parts are skipped rather than failing the whole header.
export function localeFromAcceptLanguage(header: string | null | undefined): AppLocale | null {
  if (!header) return null;
  const ranges = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.split(";");
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      return { locale: toAppLocale(tag), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((r): r is { locale: AppLocale; q: number; index: number } => r.locale !== null && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranges[0]?.locale ?? null;
}
