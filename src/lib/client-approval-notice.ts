// Buyer-org notification copy for "your client approved the shared plan".
// Sent as a notice template (notice-template.ts `clientApproved`): the email
// goes out in the org's market language, and /notifications re-renders it in
// the reader's language. Same convention as programme-autosend-notice.ts: the
// copy lives next to its sender. The approving client's own share-page
// language says nothing about the buyer's, so it never picks the locale.

import { marketDefaultLocale, type BuyerLocale } from "@/lib/market-locale";
import { planPath } from "@/lib/plan-path";

type Strings = { title: (plan: string) => string; body: string };

const STRINGS: Record<BuyerLocale, Strings> = {
  en: {
    title: (plan) => `Client approved: ${plan}`,
    body: "Your client approved the shared plan. It's ready to send to the desk.",
  },
  no: {
    title: (plan) => `Kunden godkjente: ${plan}`,
    body: "Kunden din har godkjent den delte planen. Den er klar til å sendes til desken.",
  },
  sv: {
    title: (plan) => `Kunden godkände: ${plan}`,
    body: "Din kund har godkänt den delade planen. Den är redo att skickas till desken.",
  },
  da: {
    title: (plan) => `Kunden godkendte: ${plan}`,
    body: "Din kunde har godkendt den delte plan. Den er klar til at blive sendt til desken.",
  },
  fi: {
    title: (plan) => `Asiakas hyväksyi: ${plan}`,
    body: "Asiakkaasi hyväksyi jaetun suunnitelman. Se on valmis lähetettäväksi deskille.",
  },
  de: {
    title: (plan) => `Kunde hat freigegeben: ${plan}`,
    body: "Ihr Kunde hat den geteilten Plan freigegeben. Er kann jetzt an den Desk gehen.",
  },
};

export function buildClientApprovalNotice(input: {
  marketCode: string | null;
  planName: string;
  listId: string;
  // Render in this locale instead of the market default (the inbox
  // re-renders the stored notice in the viewer's language).
  locale?: BuyerLocale;
}): { title: string; body: string; link: string; locale: BuyerLocale } {
  const locale = input.locale ?? (input.marketCode ? marketDefaultLocale(input.marketCode) : "en");
  const s = STRINGS[locale];
  return {
    title: s.title(input.planName),
    body: s.body,
    // The approved plan's own address (not /plan, which opens whatever plan
    // the recipient last had active); /plan/[listId] makes it active on open.
    link: planPath(locale, input.listId),
    locale,
  };
}
