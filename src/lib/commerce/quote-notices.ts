// Notification copy for the quote lifecycle: the buyer's "your quote is
// ready / renewed" when the desk sends it, and the buyer's order
// confirmation when they accept (or place an instant order).
//
// Rendered through the notice templates (lib/notice-template.ts `quoteSent`,
// `orderConfirmed`) in each recipient's language, never through next-intl.
// The desk's "quote accepted" is the `deskQuoteAccepted` template
// (lib/notices/desk-notices.ts).

import { formatMoney, intlLocale } from "@/lib/money";
import type { BuyerLocale } from "@/lib/market-locale";

type BuyerStrings = {
  sentTitle: (plan: string) => string;
  renewedTitle: (plan: string) => string;
  revisedTitle: (plan: string, revision: number) => string;
  // First sentence of a revised quote's body: the earlier one is gone.
  revisedNote: string;
  // `amounts` is one formatted total per market quote, joined with " + ".
  totals: (amounts: string, date: string) => string;
  onRequest: (count: number) => string;
  orderTitle: (plan: string) => string;
  orderBody: string;
};

const en: BuyerStrings = {
  sentTitle: (p) => `Your quote is ready: ${p}`,
  renewedTitle: (p) => `Your quote has been renewed: ${p}`,
  revisedTitle: (p, n) => `Your quote has been revised (revision ${n}): ${p}`,
  revisedNote: "It replaces the quote you received earlier, which can no longer be accepted.",
  totals: (a, d) => `Total ${a} incl. VAT, valid until ${d}.`,
  onRequest: (n) =>
    n === 1
      ? "One line is priced on request — we'll confirm its price separately."
      : `${n} lines are priced on request — we'll confirm their prices separately.`,
  orderTitle: (p) => `Order confirmed: ${p}`,
  orderBody:
    "Thank you — we're now booking the placements with the publishers and will keep you posted as the campaign moves.",
};

const no: BuyerStrings = {
  sentTitle: (p) => `Tilbudet ditt er klart: ${p}`,
  renewedTitle: (p) => `Tilbudet ditt er fornyet: ${p}`,
  revisedTitle: (p, n) => `Tilbudet ditt er revidert (revisjon ${n}): ${p}`,
  revisedNote: "Det erstatter tilbudet du fikk tidligere, som ikke lenger kan aksepteres.",
  totals: (a, d) => `Totalt ${a} inkl. mva., gyldig til ${d}.`,
  onRequest: (n) =>
    n === 1
      ? "Én linje er prissatt på forespørsel – vi bekrefter prisen separat."
      : `${n} linjer er prissatt på forespørsel – vi bekrefter prisene separat.`,
  orderTitle: (p) => `Bestillingen er bekreftet: ${p}`,
  orderBody:
    "Takk! Vi booker nå plasseringene hos utgiverne og holder deg oppdatert mens kampanjen tar form.",
};

const sv: BuyerStrings = {
  sentTitle: (p) => `Din offert är klar: ${p}`,
  renewedTitle: (p) => `Din offert har förnyats: ${p}`,
  revisedTitle: (p, n) => `Din offert har reviderats (version ${n}): ${p}`,
  revisedNote: "Den ersätter offerten du fick tidigare, som inte längre kan godkännas.",
  totals: (a, d) => `Totalt ${a} inkl. moms, giltig till ${d}.`,
  onRequest: (n) =>
    n === 1
      ? "En rad prissätts på förfrågan – vi bekräftar priset separat."
      : `${n} rader prissätts på förfrågan – vi bekräftar priserna separat.`,
  orderTitle: (p) => `Beställningen är bekräftad: ${p}`,
  orderBody:
    "Tack! Vi bokar nu placeringarna hos publicisterna och håller dig uppdaterad medan kampanjen tar form.",
};

const da: BuyerStrings = {
  sentTitle: (p) => `Dit tilbud er klar: ${p}`,
  renewedTitle: (p) => `Dit tilbud er fornyet: ${p}`,
  revisedTitle: (p, n) => `Dit tilbud er revideret (version ${n}): ${p}`,
  revisedNote: "Det erstatter det tilbud, du fik tidligere, som ikke længere kan accepteres.",
  totals: (a, d) => `I alt ${a} inkl. moms, gyldigt til ${d}.`,
  onRequest: (n) =>
    n === 1
      ? "Én linje er prissat på forespørgsel – vi bekræfter prisen separat."
      : `${n} linjer er prissat på forespørgsel – vi bekræfter priserne separat.`,
  orderTitle: (p) => `Ordren er bekræftet: ${p}`,
  orderBody:
    "Tak! Vi booker nu placeringerne hos udgiverne og holder dig opdateret, mens kampagnen tager form.",
};

const fi: BuyerStrings = {
  sentTitle: (p) => `Tarjouksesi on valmis: ${p}`,
  renewedTitle: (p) => `Tarjouksesi on uusittu: ${p}`,
  revisedTitle: (p, n) => `Tarjoustasi on päivitetty (versio ${n}): ${p}`,
  revisedNote: "Se korvaa aiemmin saamasi tarjouksen, jota ei voi enää hyväksyä.",
  totals: (a, d) => `Yhteensä ${a} sis. alv, voimassa ${d} asti.`,
  onRequest: (n) =>
    n === 1
      ? "Yksi rivi hinnoitellaan pyynnöstä – vahvistamme hinnan erikseen."
      : `${n} riviä hinnoitellaan pyynnöstä – vahvistamme hinnat erikseen.`,
  orderTitle: (p) => `Tilaus on vahvistettu: ${p}`,
  orderBody:
    "Kiitos! Varaamme nyt mainospaikat julkaisijoilta ja kerromme, miten kampanja etenee.",
};

const de: BuyerStrings = {
  sentTitle: (p) => `Ihr Angebot ist fertig: ${p}`,
  renewedTitle: (p) => `Ihr Angebot wurde verlängert: ${p}`,
  revisedTitle: (p, n) => `Ihr Angebot wurde überarbeitet (Version ${n}): ${p}`,
  revisedNote: "Es ersetzt das Angebot, das Sie zuvor erhalten haben; dieses kann nicht mehr angenommen werden.",
  totals: (a, d) => `Gesamt ${a} inkl. MwSt., gültig bis ${d}.`,
  onRequest: (n) =>
    n === 1
      ? "Eine Position wird auf Anfrage bepreist – den Preis bestätigen wir separat."
      : `${n} Positionen werden auf Anfrage bepreist – die Preise bestätigen wir separat.`,
  orderTitle: (p) => `Bestellung bestätigt: ${p}`,
  orderBody:
    "Vielen Dank! Wir buchen jetzt die Platzierungen bei den Verlagen und halten Sie auf dem Laufenden.",
};

const STRINGS: Record<BuyerLocale, BuyerStrings> = { en, no, sv, da, fi, de };

function stringsFor(locale: string): BuyerStrings {
  // Unknown locales get English rather than a crash mid-notification.
  return STRINGS[locale as BuyerLocale] ?? STRINGS.en;
}

export type QuoteNoticeTotal = { total: number; currency: string };

/**
 * "Your quote is ready" (the desk sent it) or "…renewed" (the desk gave an
 * expired quote a new window). The body carries the real totals — one per
 * market quote — and the validity date the desk chose, printed as the same
 * UTC calendar day the quote page shows.
 */
export function buildQuoteSentNotice(input: {
  locale: string;
  planName: string;
  quotes: QuoteNoticeTotal[];
  onRequestCount: number;
  validUntil: Date;
  renewed?: boolean;
  // Set when the send replaces an earlier quote (a revision): the newest
  // revision number going out.
  revision?: number;
}): { title: string; body: string } {
  const s = stringsFor(input.locale);
  const amounts = input.quotes
    .map((q) => formatMoney(q.total, q.currency, input.locale))
    .join(" + ");
  const date = new Intl.DateTimeFormat(intlLocale(input.locale), {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(input.validUntil);
  const revised = input.revision !== undefined;
  const body = [
    revised ? s.revisedNote : null,
    s.totals(amounts, date),
    input.onRequestCount > 0 ? s.onRequest(input.onRequestCount) : null,
  ]
    .filter(Boolean)
    .join(" ");
  const title = revised
    ? s.revisedTitle(input.planName, input.revision as number)
    : input.renewed
      ? s.renewedTitle(input.planName)
      : s.sentTitle(input.planName);
  return { title, body };
}

/** The buyer org's confirmation that accepting the quote created the order. */
export function buildOrderConfirmedNotice(input: {
  locale: string;
  planName: string;
}): { title: string; body: string } {
  const s = stringsFor(input.locale);
  return { title: s.orderTitle(input.planName), body: s.orderBody };
}
