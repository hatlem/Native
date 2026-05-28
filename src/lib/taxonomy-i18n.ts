// Maps common English taxonomy values (imported as free-text from the
// research CSV — Title.type, frequency, b2bB2c, format, geoScope, …)
// to localized equivalents per supported locale. Used by the catalog
// title-detail page so a /de or /fi buyer doesn't see English chip
// labels next to a German/Finnish page.
//
// The data is free-text, so we match on lower-cased word-boundary form
// and fall through to the raw value (the publisher- or research-team-
// supplied original) when we have no translation. The fall-through is
// deliberate: it's better to show the publisher's exact English term
// than to silently drop a label.

import type { AppLocale } from "@/i18n/routing";

type TaxonomyMap = Record<string, Partial<Record<AppLocale, string>>>;

// Lower-cased English source value → per-locale translation.
const TAXONOMY: TaxonomyMap = {
  // Publication cycle
  daily: { no: "Daglig", sv: "Dagligen", da: "Dagligt", de: "Täglich", fi: "Päivittäin" },
  "daily (mon-fri)": { no: "Daglig (man-fre)", sv: "Dagligen (mån-fre)", da: "Dagligt (man-fre)", de: "Täglich (Mo-Fr)", fi: "Päivittäin (ma-pe)" },
  weekly: { no: "Ukentlig", sv: "Veckovis", da: "Ugentligt", de: "Wöchentlich", fi: "Viikoittain" },
  "bi-weekly": { no: "Annenhver uke", sv: "Varannan vecka", da: "Hver anden uge", de: "Zweiwöchentlich", fi: "Joka toinen viikko" },
  monthly: { no: "Månedlig", sv: "Månatlig", da: "Månedligt", de: "Monatlich", fi: "Kuukausittain" },
  quarterly: { no: "Kvartalsvis", sv: "Kvartalsvis", da: "Kvartalsvis", de: "Vierteljährlich", fi: "Neljännesvuosittain" },
  // Type
  "magazine": { no: "Magasin", sv: "Magasin", da: "Magasin", de: "Magazin", fi: "Aikakauslehti" },
  "newspaper": { no: "Avis", sv: "Tidning", da: "Avis", de: "Zeitung", fi: "Sanomalehti" },
  "digital": { no: "Digital", sv: "Digital", da: "Digital", de: "Digital", fi: "Digitaalinen" },
  "print + digital": { no: "Trykk + digital", sv: "Tryck + digital", da: "Tryk + digital", de: "Print + Digital", fi: "Painettu + digitaalinen" },
  // Geo scope
  national: { no: "Nasjonal", sv: "Nationell", da: "National", de: "National", fi: "Kansallinen" },
  regional: { no: "Regional", sv: "Regional", da: "Regional", de: "Regional", fi: "Alueellinen" },
  local: { no: "Lokal", sv: "Lokal", da: "Lokal", de: "Lokal", fi: "Paikallinen" },
  international: { no: "Internasjonal", sv: "Internationell", da: "International", de: "International", fi: "Kansainvälinen" },
  // Format
  "print only": { no: "Kun trykk", sv: "Endast tryck", da: "Kun tryk", de: "Nur Print", fi: "Vain painettu" },
  "digital only": { no: "Kun digital", sv: "Endast digital", da: "Kun digital", de: "Nur digital", fi: "Vain digitaalinen" },
  // Audience B2B / B2C
  b2b: { no: "B2B", sv: "B2B", da: "B2B", de: "B2B", fi: "B2B" }, // kept as-is per locale
  b2c: { no: "B2C", sv: "B2C", da: "B2C", de: "B2C", fi: "B2C" },
};

// Vertical/category translations: only translate the common buckets the
// CSV uses. Everything else (publisher-specific terms, single-title
// niches) falls through.
const VERTICAL: TaxonomyMap = {
  "business & finance": { no: "Næringsliv og finans", sv: "Näringsliv och finans", da: "Erhverv og finans", de: "Wirtschaft & Finanzen", fi: "Liiketoiminta ja talous" },
  "business decision-makers": { no: "Næringslivs-beslutningstagere", sv: "Affärsbeslutsfattare", da: "Forretningsbeslutningstagere", de: "Geschäftsentscheider", fi: "Liiketoimintapäätökset" },
  "lifestyle": { no: "Livsstil", sv: "Livsstil", da: "Livsstil", de: "Lifestyle", fi: "Lifestyle" },
  "technology": { no: "Teknologi", sv: "Teknik", da: "Teknologi", de: "Technologie", fi: "Teknologia" },
  "health": { no: "Helse", sv: "Hälsa", da: "Sundhed", de: "Gesundheit", fi: "Terveys" },
  "sports": { no: "Sport", sv: "Sport", da: "Sport", de: "Sport", fi: "Urheilu" },
  "culture": { no: "Kultur", sv: "Kultur", da: "Kultur", de: "Kultur", fi: "Kulttuuri" },
  "news": { no: "Nyheter", sv: "Nyheter", da: "Nyheder", de: "Nachrichten", fi: "Uutiset" },
};

function lookup(map: TaxonomyMap, value: string, locale: AppLocale): string {
  if (locale === "en") return value;
  const entry = map[value.trim().toLowerCase()];
  return entry?.[locale] ?? value;
}

export function localizeTaxonomy(value: string, locale: AppLocale): string {
  return lookup(TAXONOMY, value, locale);
}

export function localizeVertical(value: string, locale: AppLocale): string {
  return lookup(VERTICAL, value, locale);
}
