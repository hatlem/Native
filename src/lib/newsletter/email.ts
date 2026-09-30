import { layout } from "@/lib/mail/templates/layout";

export type ConfirmEmailArgs = {
  confirmUrl: string;
  unsubUrl: string;
  locale: string;
  appName?: string;
};
export type BuiltEmail = { subject: string; text: string; html: string };

type ConfirmCopy = {
  subject: (app: string) => string;
  preheader: string;
  heading: string;
  body: (app: string) => string;
  cta: string;
  footer: string;
  unsubscribe: string;
};

// Double opt-in confirmation, in the language the visitor signed up in —
// it is the first thing they get from us, and the only thing standing
// between the form and the list.
const COPY: Record<"en" | "no" | "sv" | "da" | "fi" | "de", ConfirmCopy> = {
  en: {
    subject: (app) => `Confirm your ${app} subscription`,
    preheader: "One click and you're on the list.",
    heading: "Confirm your subscription",
    body: (app) =>
      `Thanks for signing up to ${app}'s newsletter: occasional, no-fluff notes on native advertising. Confirm your address to start receiving it.`,
    cta: "Confirm subscription",
    footer: "Didn't sign up? Ignore this email and you won't hear from us, or",
    unsubscribe: "unsubscribe",
  },
  no: {
    subject: (app) => `Bekreft abonnementet ditt hos ${app}`,
    preheader: "Ett klikk, så står du på listen.",
    heading: "Bekreft abonnementet",
    body: (app) =>
      `Takk for at du meldte deg på nyhetsbrevet fra ${app}: korte notater om native-annonsering, uten fyll, av og til. Bekreft adressen din for å begynne å få det.`,
    cta: "Bekreft abonnementet",
    footer: "Meldte du deg ikke på? Se bort fra denne e-posten, så hører du ikke fra oss, eller",
    unsubscribe: "meld deg av",
  },
  sv: {
    subject: (app) => `Bekräfta din prenumeration hos ${app}`,
    preheader: "Ett klick så är du med på listan.",
    heading: "Bekräfta din prenumeration",
    body: (app) =>
      `Tack för att du anmälde dig till nyhetsbrevet från ${app}: korta anteckningar om native-annonsering, utan utfyllnad, då och då. Bekräfta din adress för att börja få det.`,
    cta: "Bekräfta prenumerationen",
    footer: "Anmälde du dig inte? Strunta i mejlet så hör vi inte av oss, eller",
    unsubscribe: "avregistrera dig",
  },
  da: {
    subject: (app) => `Bekræft dit abonnement hos ${app}`,
    preheader: "Et klik, så er du på listen.",
    heading: "Bekræft dit abonnement",
    body: (app) =>
      `Tak, fordi du tilmeldte dig nyhedsbrevet fra ${app}: korte noter om native-annoncering, uden fyld, en gang imellem. Bekræft din adresse for at begynde at modtage det.`,
    cta: "Bekræft abonnement",
    footer: "Tilmeldte du dig ikke? Se bort fra mailen, så hører du ikke fra os, eller",
    unsubscribe: "afmeld dig",
  },
  fi: {
    subject: (app) => `Vahvista ${app}-tilauksesi`,
    preheader: "Yksi klikkaus, niin olet listalla.",
    heading: "Vahvista tilauksesi",
    body: (app) =>
      `Kiitos, että tilasit ${app}-uutiskirjeen: satunnaisia, asiapitoisia huomioita natiivimainonnasta. Vahvista osoitteesi, niin alat saada sitä.`,
    cta: "Vahvista tilaus",
    footer: "Etkö tilannut? Jätä viesti huomiotta, niin emme ota yhteyttä, tai",
    unsubscribe: "peru tilaus",
  },
  de: {
    subject: (app) => `Bestätigen Sie Ihr ${app}-Abonnement`,
    preheader: "Ein Klick, und Sie sind auf der Liste.",
    heading: "Abonnement bestätigen",
    body: (app) =>
      `Danke für Ihre Anmeldung zum Newsletter von ${app}: gelegentliche Notizen zu Native Advertising, ohne Füllstoff. Bestätigen Sie Ihre Adresse, um ihn zu erhalten.`,
    cta: "Abonnement bestätigen",
    footer: "Nicht angemeldet? Ignorieren Sie diese E-Mail, dann hören Sie nichts von uns, oder",
    unsubscribe: "abmelden",
  },
};

export function buildConfirmEmail({
  confirmUrl,
  unsubUrl,
  locale,
  appName = "NativeSpin",
}: ConfirmEmailArgs): BuiltEmail {
  const t = COPY[locale as keyof typeof COPY] ?? COPY.en;
  const body = t.body(appName);
  const text = [
    body,
    "",
    `${t.cta}:`,
    confirmUrl,
    "",
    `${t.footer} ${t.unsubscribe}:`,
    unsubUrl,
  ].join("\n");
  const html = layout({
    preheader: t.preheader,
    heading: t.heading,
    body,
    cta: { label: t.cta, url: confirmUrl },
    footer: t.footer,
    footerLink: { label: `${t.unsubscribe}.`, url: unsubUrl },
    appName,
  });
  return { subject: t.subject(appName), text, html };
}
