// The name a submitted Plan (and so its Request/Order) carries on every
// buyer and desk surface: /requests, the request header, Home, the order
// page and notifications. It is the buyer's own name for the plan — the
// SavedList name they typed on /plan — so two campaigns from one org don't
// both read "Acme AS — campaign".
//
// Lists the buyer never named still hold a system default (the column
// default and the few server-side creators below). Those are English words,
// not a name the buyer chose, so they fall back to "<org> — <campaign>" in
// the submit locale instead of leaking "Untitled list" into the request.
//
// The fallback is written once, at submit, in the locale of whoever
// submitted (Plan.name is stored data, not a message key).

import type { BuyerLocale } from "@/lib/market-locale";

/** System-generated SavedList names — never a buyer's choice. Kept in step
 *  with: the SavedList.name column default and list-actions/favorites
 *  ("Untitled list"), lists.ts basket import ("Imported list") and the
 *  reorder action in plan-actions.ts ("Reordered campaign"). */
const SYSTEM_LIST_NAMES = new Set(["untitled list", "imported list", "reordered campaign"]);

const CAMPAIGN_WORD: Record<BuyerLocale, string> = {
  en: "campaign",
  no: "kampanje",
  sv: "kampanj",
  da: "kampagne",
  fi: "kampanja",
  de: "Kampagne",
};

export function isSystemListName(name: string): boolean {
  return SYSTEM_LIST_NAMES.has(name.trim().toLowerCase());
}

export function planNameFor(input: {
  listName: string | null | undefined;
  orgName: string;
  locale: string;
}): string {
  const own = input.listName?.trim() ?? "";
  if (own && !isSystemListName(own)) return own;
  const word = CAMPAIGN_WORD[input.locale as BuyerLocale] ?? CAMPAIGN_WORD.en;
  return `${input.orgName} — ${word}`;
}
