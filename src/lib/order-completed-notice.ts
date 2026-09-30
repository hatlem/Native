// Localized copy for the ORDER_COMPLETED buyer notification (in-app row
// + email via notifyOrg). Strings live here rather than in the UI
// message files for the same reason src/lib/mail/templates/strings.ts
// keeps email copy out of them: this text is rendered server-side at
// send time, never through next-intl, so putting it in the JSON files
// would only couple it to the locale-parity test without any component
// ever reading it.
//
// Terminology matches the plan.programme UI namespace so the buyer
// reads the same words in the notification as on the plan screen:
// wave = runde (no/da) / omgång (sv) / kierros (fi) / Welle (de).

import type { BuyerLocale } from "@/lib/market-locale";

export type OrderCompletedNoticeInput = {
  locale: string;
  planName: string;
  due: null | {
    waveNumber: number;
    plannedWaves: number;
    articleTitle: string | null;
  };
  // Delivery evidence at the moment of completion (order-lifecycle.ts
  // deliveryGap). When some placements have no published link, the copy
  // states the count instead of "your placements have run": the desk can
  // close an order ahead of the evidence, but the buyer must not be told
  // something ran that nobody saw run. Omitted = fully delivered.
  delivery?: { published: number; total: number };
};

type NoticeStrings = {
  title: (planName: string) => string;
  // The next programme wave is drafted and due: nudge them to send it
  // while the previous placement is still fresh in readers' minds.
  bodyDue: (waveNumber: number, plannedWaves: number, articleTitle: string | null) => string;
  // No due wave: the campaign is simply finished — sell the repetition
  // logic and point them at planning the next wave.
  bodyFinished: string;
  // Replace bodyFinished's "your placements have run" when not every
  // placement has a published link.
  closed: string;
  deliveryNote: (published: number, total: number) => string;
};

const en: NoticeStrings = {
  title: (planName) => `Campaign finished: ${planName}`,
  bodyDue: (n, m, angle) =>
    `Wave ${n} of ${m} is ready to send${angle ? ` — angle: ${angle}` : ""}. ` +
    `A fresh article now, while readers still remember the last one, is what turns one placement into a campaign that sticks.`,
  bodyFinished:
    "Your placements have run. Native works through repetition — plan the next wave with a fresh article angle while readers still remember this one.",
  closed: "The campaign is closed.",
  deliveryNote: (p, t) => `${p} of ${t} placements have a published link; open the order to check them.`,
};

const no: NoticeStrings = {
  title: (planName) => `Kampanjen er ferdig: ${planName}`,
  bodyDue: (n, m, angle) =>
    `Runde ${n} av ${m} er klar til å sendes${angle ? ` – vinkel: ${angle}` : ""}. ` +
    `En fersk artikkel nå, mens leserne fortsatt husker den forrige, er det som gjør én plassering til en kampanje som fester seg.`,
  bodyFinished:
    "Plasseringene dine har kjørt. Native virker gjennom gjentakelse – planlegg neste runde med en ny artikkelvinkel mens leserne fortsatt husker denne.",
  closed: "Kampanjen er avsluttet.",
  deliveryNote: (p, t) => `${p} av ${t} plasseringer har publisert lenke – åpne bestillingen for å se dem.`,
};

const sv: NoticeStrings = {
  title: (planName) => `Kampanjen är klar: ${planName}`,
  bodyDue: (n, m, angle) =>
    `Omgång ${n} av ${m} är redo att skickas${angle ? ` – vinkel: ${angle}` : ""}. ` +
    `En färsk artikel nu, medan läsarna fortfarande minns den förra, är det som gör en enskild placering till en kampanj som fastnar.`,
  bodyFinished:
    "Dina placeringar har gått ut. Native bygger på upprepning – planera nästa omgång med en ny artikelvinkel medan läsarna fortfarande minns den här.",
  closed: "Kampanjen är avslutad.",
  deliveryNote: (p, t) => `${p} av ${t} placeringar har en publicerad länk – öppna ordern för att se dem.`,
};

const da: NoticeStrings = {
  title: (planName) => `Kampagnen er afsluttet: ${planName}`,
  bodyDue: (n, m, angle) =>
    `Runde ${n} af ${m} er klar til at blive sendt${angle ? ` – vinkel: ${angle}` : ""}. ` +
    `En frisk artikel nu, mens læserne stadig husker den forrige, er det, der gør én placering til en kampagne, der sætter sig fast.`,
  bodyFinished:
    "Dine placeringer er kørt. Native virker gennem gentagelse – planlæg næste runde med en ny artikelvinkel, mens læserne stadig husker denne.",
  closed: "Kampagnen er afsluttet.",
  deliveryNote: (p, t) => `${p} af ${t} placeringer har et publiceret link – åbn ordren for at se dem.`,
};

const fi: NoticeStrings = {
  title: (planName) => `Kampanja on päättynyt: ${planName}`,
  bodyDue: (n, m, angle) =>
    `Kierros ${n}/${m} on valmis lähetettäväksi${angle ? ` – näkökulma: ${angle}` : ""}. ` +
    `Tuore artikkeli nyt, kun lukijat vielä muistavat edellisen, tekee yhdestä sijoittelusta kampanjan, joka jää mieleen.`,
  bodyFinished:
    "Sijoittelusi ovat pyörineet loppuun. Native toimii toiston kautta – suunnittele seuraava kierros uudella artikkelin näkökulmalla, kun lukijat vielä muistavat tämän.",
  closed: "Kampanja on suljettu.",
  deliveryNote: (p, t) => `${p}/${t} sijoittelulla on julkaistu linkki – avaa tilaus nähdäksesi ne.`,
};

const de: NoticeStrings = {
  title: (planName) => `Kampagne abgeschlossen: ${planName}`,
  bodyDue: (n, m, angle) =>
    `Welle ${n} von ${m} ist bereit zum Versand${angle ? ` – Blickwinkel: ${angle}` : ""}. ` +
    `Ein frischer Artikel jetzt, solange die Leser sich noch an den letzten erinnern, macht aus einer einzelnen Platzierung eine Kampagne, die hängen bleibt.`,
  bodyFinished:
    "Ihre Platzierungen sind gelaufen. Native wirkt durch Wiederholung – planen Sie die nächste Welle mit einem neuen Blickwinkel, solange die Leser sich noch an diesen erinnern.",
  closed: "Die Kampagne ist abgeschlossen.",
  deliveryNote: (p, t) => `${p} von ${t} Platzierungen haben einen veröffentlichten Link – öffnen Sie den Auftrag, um sie zu sehen.`,
};

const STRINGS: Record<BuyerLocale, NoticeStrings> = { en, no, sv, da, fi, de };

export function buildOrderCompletedNotice(
  input: OrderCompletedNoticeInput,
): { title: string; body: string } {
  // Tolerate any string (callers may pass a raw URL segment); unknown
  // locales get English rather than a crash mid-notification.
  const s = STRINGS[input.locale as BuyerLocale] ?? STRINGS.en;
  const d = input.delivery;
  const note = d && d.published < d.total ? s.deliveryNote(d.published, d.total) : null;
  if (input.due) {
    const due = s.bodyDue(input.due.waveNumber, input.due.plannedWaves, input.due.articleTitle);
    return { title: s.title(input.planName), body: note ? `${due} ${note}` : due };
  }
  return {
    title: s.title(input.planName),
    body: note ? `${s.closed} ${note}` : s.bodyFinished,
  };
}
