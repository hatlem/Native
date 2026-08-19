// Buyer-org notification copy for a placeholder line whose title has gained a
// real, bookable placement — localized by the org's market (same convention as
// programme-autosend-notice.ts / order-completed-notice.ts: notification copy
// lives in code next to its sender, and the recipient's locale comes from the
// org market since notifications have no per-user locale yet).
//
// The body names the button the buyer must press, in their own language —
// the exact label from src/messages/<locale>.json ("plan.resolve").

import { marketDefaultLocale, type BuyerLocale } from "@/lib/market-locale";

type Strings = {
  title: (titleName: string) => string;
  body: (titleName: string, listName: string) => string;
};

const STRINGS: Record<BuyerLocale, Strings> = {
  en: {
    title: (t) => `${t} now has a price`,
    body: (t, list) =>
      `A placement is now available for ${t} in the list “${list}”. Open the plan and pick it under “Use placement”.`,
  },
  no: {
    title: (t) => `${t} har nå en pris`,
    body: (t, list) =>
      `En plassering er nå tilgjengelig for ${t} i listen «${list}». Åpne planen og velg den under «Bruk plassering».`,
  },
  sv: {
    title: (t) => `${t} har nu ett pris`,
    body: (t, list) =>
      `En placering är nu tillgänglig för ${t} i listan ”${list}”. Öppna planen och välj den under ”Använd placering”.`,
  },
  da: {
    title: (t) => `${t} har nu en pris`,
    body: (t, list) =>
      `En placering er nu tilgængelig for ${t} på listen “${list}”. Åbn planen, og vælg den under “Brug placering”.`,
  },
  fi: {
    title: (t) => `${t} on nyt hinnoiteltu`,
    body: (t, list) =>
      `Mainospaikka on nyt saatavilla julkaisulle ${t} listalla ”${list}”. Avaa suunnitelma ja valitse se kohdasta ”Käytä mainospaikkaa”.`,
  },
  de: {
    title: (t) => `${t} hat jetzt einen Preis`,
    body: (t, list) =>
      `Für ${t} ist jetzt eine Platzierung in der Liste „${list}“ verfügbar. Öffnen Sie den Plan und wählen Sie sie unter „Platzierung verwenden“.`,
  },
};

export function buildPlacementReadyNotice(input: {
  marketCode: string | null;
  titleName: string;
  listName: string;
  listId: string;
  // Override the copy/link locale — the desk notice reuses this builder with
  // "en" (the source language) instead of the buying org's market locale.
  locale?: BuyerLocale;
}): { title: string; body: string; link: string; locale: BuyerLocale } {
  const locale =
    input.locale ?? (input.marketCode ? marketDefaultLocale(input.marketCode) : "en");
  const s = STRINGS[locale];
  return {
    title: s.title(input.titleName),
    body: s.body(input.titleName, input.listName),
    // /plan/open is a Route Handler that makes this list the active one (writes
    // the cookie) before landing on /plan — so the page the buyer sees and the
    // list their "Send til desk" button submits are always the same list.
    link: `/${locale}/plan/open?list=${input.listId}`,
    locale,
  };
}
