import type { ContentLanguage, ContentTopic } from "@prisma/client";

// Market country code → the language a writer must produce in. Several
// markets share a language (DE/AT/CH, UK/IE), which is exactly why match
// criteria use ContentLanguage rather than MarketCode.
const COUNTRY_LANGUAGE: Record<string, ContentLanguage> = {
  NO: "NO",
  SE: "SV",
  DK: "DA",
  FI: "FI",
  DE: "DE",
  AT: "DE",
  CH: "DE",
  UK: "EN",
  IE: "EN",
};

export function languageForCountry(
  countryCode: string,
): ContentLanguage | null {
  return COUNTRY_LANGUAGE[countryCode] ?? null;
}

// Loose map from a Title.category free-text value to a specialty topic.
// Unknown categories fall back to OTHER — matching still works off
// language; topic overlap is a secondary sort signal.
const CATEGORY_TOPIC: Record<string, ContentTopic> = {
  business: "FINANCE",
  finance: "FINANCE",
  economy: "FINANCE",
  b2b: "B2B",
  health: "HEALTH",
  tech: "TECH",
  technology: "TECH",
  lifestyle: "LIFESTYLE",
  travel: "TRAVEL",
  food: "FOOD",
  culture: "CULTURE",
  sustainability: "SUSTAINABILITY",
};

export function topicForCategory(category: string): ContentTopic {
  return CATEGORY_TOPIC[category.toLowerCase()] ?? "OTHER";
}
