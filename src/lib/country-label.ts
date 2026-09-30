import daMessages from "@/messages/da.json";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import fiMessages from "@/messages/fi.json";
import noMessages from "@/messages/no.json";
import svMessages from "@/messages/sv.json";

// Country names for documents rendered outside next-intl's request scope
// (invoice PDF, invoice page seller block). The names come from the `market`
// namespace — the same labels the account page and catalog use — so a
// Norwegian invoice says "Norge" and a German one "Norwegen".
const MARKET_NAMES: Record<string, Record<string, string>> = {
  da: daMessages.market,
  de: deMessages.market,
  en: enMessages.market,
  fi: fiMessages.market,
  no: noMessages.market,
  sv: svMessages.market,
};

// ISO alpha-2 spellings of the codes the `market` namespace keys differently.
const CODE_ALIASES: Readonly<Record<string, string>> = { GB: "UK" };

// Lower-cased code or name (in any UI language) → market code.
const BY_NAME: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const names of Object.values(MARKET_NAMES)) {
    for (const [code, name] of Object.entries(names)) {
      map.set(code.toLowerCase(), code);
      map.set(name.toLowerCase(), code);
    }
  }
  for (const [alias, code] of Object.entries(CODE_ALIASES)) map.set(alias.toLowerCase(), code);
  return map;
})();

/**
 * A free-text country (a code like "NO" or a name in any UI language, e.g.
 * the SELLER_COUNTRY env value "Norway") in `locale`'s language. A value we
 * don't recognise is returned as written rather than dropped — it is still
 * the seller's own statement of their address.
 */
export function localizedCountry(value: string, locale: string): string {
  const code = BY_NAME.get(value.trim().toLowerCase());
  if (!code) return value;
  const names = MARKET_NAMES[locale] ?? MARKET_NAMES.en;
  return names[code] ?? value;
}
