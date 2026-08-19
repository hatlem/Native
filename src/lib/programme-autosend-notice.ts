// Buyer-org notification copy for an auto-sent wave, localized by the org's
// market (same convention as order-completed-notice.ts: notification/email
// copy lives in code next to its sender, not in the UI message files, and the
// recipient's locale comes from the org market since notifications have no
// per-user locale yet).

import { marketDefaultLocale, type BuyerLocale } from "@/lib/market-locale";

type Strings = {
  title: (n: number, of: number) => string;
  body: (programmeName: string) => string;
};

const STRINGS: Record<BuyerLocale, Strings> = {
  en: {
    title: (n, of) => `Wave ${n} of ${of} sent to the desk`,
    body: (name) =>
      `${name}: this wave was submitted automatically. You approve the quote before anything is booked or charged.`,
  },
  no: {
    title: (n, of) => `Runde ${n} av ${of} er sendt til desken`,
    body: (name) =>
      `${name}: denne runden ble sendt inn automatisk. Du godkjenner tilbudet før noe bestilles eller belastes.`,
  },
  sv: {
    title: (n, of) => `Omgång ${n} av ${of} har skickats till desken`,
    body: (name) =>
      `${name}: den här omgången skickades in automatiskt. Du godkänner offerten innan något bokas eller debiteras.`,
  },
  da: {
    title: (n, of) => `Runde ${n} af ${of} er sendt til desken`,
    body: (name) =>
      `${name}: denne runde blev indsendt automatisk. Du godkender tilbuddet, før noget bookes eller opkræves.`,
  },
  fi: {
    title: (n, of) => `Kierros ${n}/${of} lähetetty deskille`,
    body: (name) =>
      `${name}: tämä kierros lähetettiin automaattisesti. Hyväksyt tarjouksen ennen kuin mitään varataan tai veloitetaan.`,
  },
  de: {
    title: (n, of) => `Welle ${n} von ${of} an den Desk gesendet`,
    body: (name) =>
      `${name}: Diese Welle wurde automatisch eingereicht. Sie geben das Angebot frei, bevor etwas gebucht oder berechnet wird.`,
  },
};

export function buildAutoSendNotice(input: {
  marketCode: string | null;
  programmeName: string;
  waveNumber: number;
  plannedWaves: number;
  requestId: string;
}): { title: string; body: string; link: string; locale: BuyerLocale } {
  const locale = input.marketCode ? marketDefaultLocale(input.marketCode) : "en";
  const s = STRINGS[locale];
  return {
    title: s.title(input.waveNumber, input.plannedWaves),
    body: s.body(input.programmeName),
    link: `/${locale}/requests/${input.requestId}`,
    locale,
  };
}
