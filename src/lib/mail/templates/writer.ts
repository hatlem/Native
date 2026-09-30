// Writer-facing transactional email: the pool invite and a new line
// assignment. Same shell as the auth emails (layout.ts); copy lives here
// rather than in strings.ts because these aren't auth emails and are only
// ever sent from the writer flows.

import { layout } from "./layout";
import type { EmailLocale } from "@/lib/writers/email-locale";

type Copy = {
  invite: {
    subject: string;
    preheader: string;
    heading: string;
    body: (inviter: string, days: number) => string;
    cta: string;
    footer: string;
  };
  assigned: {
    subject: (title: string) => string;
    preheader: string;
    heading: string;
    body: (format: string, title: string) => string;
    cta: string;
    footer: string;
  };
};

const COPY: Record<EmailLocale, Copy> = {
  en: {
    invite: {
      subject: "You're invited to write for NativeSpin",
      preheader: "Create your writer account to start receiving briefs.",
      heading: "Join NativeSpin as a writer",
      body: (inviter, days) =>
        `${inviter} has invited you to NativeSpin's writer pool. Create your account to receive briefs, write your drafts and send them for review — all in one place. The link is valid for ${days} days and can only be used once.`,
      cta: "Accept the invite",
      footer: "If you weren't expecting this, you can safely ignore this email.",
    },
    assigned: {
      subject: (title) => `New assignment: ${title}`,
      preheader: "A new brief is waiting in your writer portal.",
      heading: "You have a new assignment",
      body: (format, title) =>
        `The NativeSpin desk has assigned you a new piece for ${title} (${format}). The brief, the format spec and the playbook are waiting in your writer portal.`,
      cta: "Open the brief",
      footer: "You're receiving this because you're in NativeSpin's writer pool.",
    },
  },
  no: {
    invite: {
      subject: "Du er invitert til å skrive for NativeSpin",
      preheader: "Opprett skribentkontoen din for å få briefer.",
      heading: "Bli skribent hos NativeSpin",
      body: (inviter, days) =>
        `${inviter} har invitert deg til skribentpoolen hos NativeSpin. Opprett kontoen din for å få briefer, skrive utkast og sende dem til gjennomgang – alt på ett sted. Lenken er gyldig i ${days} dager og kan bare brukes én gang.`,
      cta: "Godta invitasjonen",
      footer: "Hvis du ikke ventet denne e-posten, kan du trygt se bort fra den.",
    },
    assigned: {
      subject: (title) => `Nytt oppdrag: ${title}`,
      preheader: "En ny brief venter i skribentportalen din.",
      heading: "Du har fått et nytt oppdrag",
      body: (format, title) =>
        `NativeSpin-desken har gitt deg et nytt oppdrag for ${title} (${format}). Briefen, formatkravene og playbooken ligger klare i skribentportalen din.`,
      cta: "Åpne briefen",
      footer: "Du får denne e-posten fordi du er med i skribentpoolen til NativeSpin.",
    },
  },
  sv: {
    invite: {
      subject: "Du är inbjuden att skriva för NativeSpin",
      preheader: "Skapa ditt skribentkonto för att börja få briefer.",
      heading: "Bli skribent hos NativeSpin",
      body: (inviter, days) =>
        `${inviter} har bjudit in dig till NativeSpins skribentpool. Skapa ditt konto för att få briefer, skriva utkast och skicka dem för granskning – allt på ett ställe. Länken gäller i ${days} dagar och kan bara användas en gång.`,
      cta: "Acceptera inbjudan",
      footer: "Om du inte väntade dig det här mejlet kan du bortse från det.",
    },
    assigned: {
      subject: (title) => `Nytt uppdrag: ${title}`,
      preheader: "En ny brief väntar i din skribentportal.",
      heading: "Du har fått ett nytt uppdrag",
      body: (format, title) =>
        `NativeSpins desk har gett dig ett nytt uppdrag för ${title} (${format}). Briefen, formatkraven och playbooken finns i din skribentportal.`,
      cta: "Öppna briefen",
      footer: "Du får det här mejlet eftersom du ingår i NativeSpins skribentpool.",
    },
  },
  da: {
    invite: {
      subject: "Du er inviteret til at skrive for NativeSpin",
      preheader: "Opret din skribentkonto for at modtage briefs.",
      heading: "Bliv skribent hos NativeSpin",
      body: (inviter, days) =>
        `${inviter} har inviteret dig til NativeSpins skribentpulje. Opret din konto for at modtage briefs, skrive udkast og sende dem til gennemsyn – alt ét sted. Linket er gyldigt i ${days} dage og kan kun bruges én gang.`,
      cta: "Accepter invitationen",
      footer: "Hvis du ikke forventede denne e-mail, kan du roligt se bort fra den.",
    },
    assigned: {
      subject: (title) => `Ny opgave: ${title}`,
      preheader: "Et nyt brief venter i din skribentportal.",
      heading: "Du har fået en ny opgave",
      body: (format, title) =>
        `NativeSpins desk har givet dig en ny opgave for ${title} (${format}). Briefet, formatkravene og playbooken ligger klar i din skribentportal.`,
      cta: "Åbn briefet",
      footer: "Du modtager denne e-mail, fordi du er med i NativeSpins skribentpulje.",
    },
  },
  fi: {
    invite: {
      subject: "Sinut on kutsuttu kirjoittamaan NativeSpinille",
      preheader: "Luo kirjoittajatilisi, niin saat briiffit suoraan.",
      heading: "Liity NativeSpinin kirjoittajaksi",
      body: (inviter, days) =>
        `${inviter} kutsui sinut NativeSpinin kirjoittajapooliin. Luo tili, niin saat briiffit, kirjoitat luonnokset ja lähetät ne tarkastettaviksi yhdessä paikassa. Linkki on voimassa ${days} päivää, ja sen voi käyttää vain kerran.`,
      cta: "Hyväksy kutsu",
      footer: "Jos et odottanut tätä viestiä, voit jättää sen huomiotta.",
    },
    assigned: {
      subject: (title) => `Uusi toimeksianto: ${title}`,
      preheader: "Uusi briiffi odottaa kirjoittajaportaalissasi.",
      heading: "Sait uuden toimeksiannon",
      body: (format, title) =>
        `NativeSpinin desk antoi sinulle uuden toimeksiannon: ${title} (${format}). Briiffi, formaatin vaatimukset ja playbook odottavat kirjoittajaportaalissasi.`,
      cta: "Avaa briiffi",
      footer: "Saat tämän viestin, koska kuulut NativeSpinin kirjoittajapooliin.",
    },
  },
  de: {
    invite: {
      subject: "Sie sind eingeladen, für NativeSpin zu schreiben",
      preheader: "Legen Sie Ihr Autorenkonto an, um Briefings zu erhalten.",
      heading: "Werden Sie Autor:in bei NativeSpin",
      body: (inviter, days) =>
        `${inviter} hat Sie in den Autorenpool von NativeSpin eingeladen. Legen Sie Ihr Konto an, um Briefings zu erhalten, Entwürfe zu schreiben und zur Freigabe einzureichen – alles an einem Ort. Der Link ist ${days} Tage gültig und kann nur einmal verwendet werden.`,
      cta: "Einladung annehmen",
      footer: "Falls Sie diese E-Mail nicht erwartet haben, können Sie sie ignorieren.",
    },
    assigned: {
      subject: (title) => `Neuer Auftrag: ${title}`,
      preheader: "Ein neues Briefing wartet in Ihrem Autorenportal.",
      heading: "Sie haben einen neuen Auftrag",
      body: (format, title) =>
        `Der NativeSpin-Desk hat Ihnen einen neuen Auftrag für ${title} zugewiesen (${format}). Briefing, Formatvorgaben und Playbook liegen in Ihrem Autorenportal bereit.`,
      cta: "Briefing öffnen",
      footer: "Sie erhalten diese E-Mail, weil Sie zum Autorenpool von NativeSpin gehören.",
    },
  },
};

type Built = { subject: string; text: string; html: string };

function build(args: {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  cta: string;
  url: string;
  footer: string;
  appName: string;
}): Built {
  return {
    subject: args.subject,
    text: `${args.body}\n\n${args.cta}: ${args.url}\n\n${args.footer}`,
    html: layout({
      preheader: args.preheader,
      heading: args.heading,
      body: args.body,
      cta: { label: args.cta, url: args.url },
      footer: args.footer,
      appName: args.appName,
    }),
  };
}

export function writerInviteEmail(args: {
  locale: EmailLocale;
  inviterName: string;
  url: string;
  validDays: number;
  appName: string;
}): Built {
  const c = COPY[args.locale].invite;
  return build({
    subject: c.subject,
    preheader: c.preheader,
    heading: c.heading,
    body: c.body(args.inviterName, args.validDays),
    cta: c.cta,
    url: args.url,
    footer: c.footer,
    appName: args.appName,
  });
}

/** The assignment's subject + body on their own: the writer's in-app notice
 *  (notice template `writerAssigned`) reads the same copy as this email. */
export function writerAssignedCopy(args: {
  locale: EmailLocale;
  format: string;
  titleName: string;
}): { title: string; body: string } {
  const c = COPY[args.locale].assigned;
  return { title: c.subject(args.titleName), body: c.body(args.format, args.titleName) };
}

export function writerAssignedEmail(args: {
  locale: EmailLocale;
  // Localized format label ("Native-artikkel").
  format: string;
  titleName: string;
  url: string;
  appName: string;
}): Built {
  const c = COPY[args.locale].assigned;
  return build({
    subject: c.subject(args.titleName),
    preheader: c.preheader,
    heading: c.heading,
    body: c.body(args.format, args.titleName),
    cta: c.cta,
    url: args.url,
    footer: c.footer,
    appName: args.appName,
  });
}
