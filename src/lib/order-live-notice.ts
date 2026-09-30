// Localized copy for the buyer notification sent when the desk moves an
// order to LIVE. Same placement rationale as order-completed-notice.ts:
// rendered server-side at send time, never through next-intl.
//
// The copy is built from delivery evidence (order-lifecycle.ts
// deliveryGap), not from the status alone: "your campaign is published"
// only when every placement actually has a published link. The desk may
// advance an order ahead of the evidence (after confirming), and the buyer
// must not be told something ran when nobody has seen it run.

import type { BuyerLocale } from "@/lib/market-locale";

export type OrderLiveNoticeInput = {
  locale: string;
  planName: string;
  published: number;
  total: number;
};

type NoticeStrings = {
  titlePublished: (planName: string) => string;
  titleUpdate: (planName: string) => string;
  bodyAll: (total: number) => string;
  bodySome: (published: number, total: number) => string;
  bodyNone: string;
};

const en: NoticeStrings = {
  titlePublished: (p) => `Your campaign is published: ${p}`,
  titleUpdate: (p) => `Campaign update: ${p}`,
  bodyAll: (t) =>
    t === 1
      ? "The placement is published. Open the order for the link and early results."
      : `All ${t} placements are published. Open the order for the links and early results.`,
  bodySome: (p, t) => `${p} of ${t} placements are published so far. Open the order to see which ones are up.`,
  bodyNone:
    "Your campaign is under way, but no placement has a published link yet. You'll see each one on the order as soon as the publisher confirms it.",
};

const no: NoticeStrings = {
  titlePublished: (p) => `Kampanjen din er publisert: ${p}`,
  titleUpdate: (p) => `Kampanjestatus: ${p}`,
  bodyAll: (t) =>
    t === 1
      ? "Plasseringen er publisert. Åpne bestillingen for lenken og de første resultatene."
      : `Alle ${t} plasseringene er publisert. Åpne bestillingen for lenkene og de første resultatene.`,
  bodySome: (p, t) => `${p} av ${t} plasseringer er publisert så langt. Åpne bestillingen for å se hvilke som er ute.`,
  bodyNone:
    "Kampanjen er i gang, men ingen plassering har fått publisert lenke ennå. Du ser hver enkelt på bestillingen så snart utgiveren bekrefter den.",
};

const sv: NoticeStrings = {
  titlePublished: (p) => `Din kampanj är publicerad: ${p}`,
  titleUpdate: (p) => `Kampanjstatus: ${p}`,
  bodyAll: (t) =>
    t === 1
      ? "Placeringen är publicerad. Öppna ordern för länken och de första resultaten."
      : `Alla ${t} placeringar är publicerade. Öppna ordern för länkarna och de första resultaten.`,
  bodySome: (p, t) => `${p} av ${t} placeringar är publicerade hittills. Öppna ordern för att se vilka som är ute.`,
  bodyNone:
    "Kampanjen är igång, men ingen placering har fått en publicerad länk än. Du ser varje placering på ordern så snart publicisten bekräftar den.",
};

const da: NoticeStrings = {
  titlePublished: (p) => `Din kampagne er publiceret: ${p}`,
  titleUpdate: (p) => `Kampagnestatus: ${p}`,
  bodyAll: (t) =>
    t === 1
      ? "Placeringen er publiceret. Åbn ordren for linket og de første resultater."
      : `Alle ${t} placeringer er publiceret. Åbn ordren for links og de første resultater.`,
  bodySome: (p, t) => `${p} af ${t} placeringer er publiceret indtil videre. Åbn ordren for at se, hvilke der er ude.`,
  bodyNone:
    "Kampagnen er i gang, men ingen placering har fået et publiceret link endnu. Du kan se hver placering på ordren, så snart udgiveren bekræfter den.",
};

const fi: NoticeStrings = {
  titlePublished: (p) => `Kampanjasi on julkaistu: ${p}`,
  titleUpdate: (p) => `Kampanjan tilanne: ${p}`,
  bodyAll: (t) =>
    t === 1
      ? "Sijoittelu on julkaistu. Avaa tilaus nähdäksesi linkin ja ensimmäiset tulokset."
      : `Kaikki ${t} sijoittelua on julkaistu. Avaa tilaus nähdäksesi linkit ja ensimmäiset tulokset.`,
  bodySome: (p, t) => `${p}/${t} sijoittelusta on julkaistu tähän mennessä. Avaa tilaus nähdäksesi, mitkä ovat jo näkyvillä.`,
  bodyNone:
    "Kampanja on käynnissä, mutta yhdelläkään sijoittelulla ei ole vielä julkaistua linkkiä. Näet jokaisen tilauksella heti, kun julkaisija vahvistaa sen.",
};

const de: NoticeStrings = {
  titlePublished: (p) => `Ihre Kampagne ist veröffentlicht: ${p}`,
  titleUpdate: (p) => `Kampagnenstatus: ${p}`,
  bodyAll: (t) =>
    t === 1
      ? "Die Platzierung ist veröffentlicht. Öffnen Sie den Auftrag für den Link und erste Ergebnisse."
      : `Alle ${t} Platzierungen sind veröffentlicht. Öffnen Sie den Auftrag für die Links und erste Ergebnisse.`,
  bodySome: (p, t) =>
    `${p} von ${t} Platzierungen sind bisher veröffentlicht. Öffnen Sie den Auftrag, um zu sehen, welche bereits online sind.`,
  bodyNone:
    "Die Kampagne läuft an, aber noch keine Platzierung hat einen veröffentlichten Link. Sie sehen jede Platzierung im Auftrag, sobald der Publisher sie bestätigt.",
};

const STRINGS: Record<BuyerLocale, NoticeStrings> = { en, no, sv, da, fi, de };

export function buildOrderLiveNotice(input: OrderLiveNoticeInput): { title: string; body: string } {
  const s = STRINGS[input.locale as BuyerLocale] ?? STRINGS.en;
  const allPublished = input.total > 0 && input.published >= input.total;
  if (allPublished) {
    return { title: s.titlePublished(input.planName), body: s.bodyAll(input.total) };
  }
  return {
    title: s.titleUpdate(input.planName),
    body: input.published > 0 ? s.bodySome(input.published, input.total) : s.bodyNone,
  };
}
