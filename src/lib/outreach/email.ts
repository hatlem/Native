import type { MarketCode } from "@prisma/client";
import type { SequenceStep } from "./sequence";

export type Locale = "en" | "no" | "sv" | "da" | "fi" | "de";

export function localeForMarketCode(code: MarketCode): Locale {
  switch (code) {
    case "NO": return "no";
    case "SE": return "sv";
    case "DK": return "da";
    case "FI": return "fi";
    case "DE":
    case "AT":
    case "CH": return "de";
    case "UK":
    case "IE":
    // NL/BE have no own locale yet — English is the outreach language there.
    case "NL":
    case "BE": return "en";
  }
}

export type TitleRef = { name: string; marketCode: MarketCode };

export type BuildArgs = {
  step: SequenceStep;
  locale: Locale;
  recipientName: string | null;
  titles: TitleRef[];
  link: string;
  // Only used by the final (bump2) breakaway email — initial + bump1 are
  // pure business inquiries with no opt-out, since unsubscribing here means
  // we never get prices and the publisher never gets sold to our advertisers.
  unsubscribeLink: string;
};

export type Built = { subject: string; text: string };

const SIGNATURE = "Elias Getia, NativeSpin";
const MAX_TITLES_INLINE = 8;

function titleLines(titles: TitleRef[], moreLine: (n: number) => string): string {
  const shown = titles.slice(0, MAX_TITLES_INLINE);
  const lines = shown.map((t) => `  • ${t.name} (${t.marketCode})`);
  const extra = titles.length - shown.length;
  if (extra > 0) lines.push(`  ${moreLine(extra)}`);
  return lines.join("\n");
}

// ---------- Norwegian ----------
function no_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Prisforespørsel for ${a.titles.length} titler — annonsør ser etter native`,
    text: [
      greeting,
      ``,
      `Vi har en annonsør vi ønsker å sjekke priser og muligheter for, og titlene deres er aktuelle. Vi vil gjerne ha en oversikt over priser for native og annonsørinnhold på:`,
      ``,
      titleLines(a.titles, (n) => `…og ${n} til`),
      ``,
      `Formater vi er interessert i:`,
      `  • Native-artikkel / annonsørinnhold`,
      `  • Sponset innhold`,
      `  • Brand stories`,
      `  • Video native`,
      `  • Andre formater dere tilbyr`,
      ``,
      `Har dere ulike rate cards per publikasjon, send gjerne alle.`,
      ``,
      `Svar gjerne direkte på denne e-posten med rate cards eller priser — det er det enkleste. Dere kan også legge dem inn her om dere foretrekker det:`,
      a.link,
      ``,
      `Om du ikke er riktig person til å svare på dette, videresend gjerne internt, svar på denne e-posten, eller gi oss beskjed via lenken.`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}
function no_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Re: Prisforespørsel for ${a.titles.length} titler`,
    text: [
      greeting,
      ``,
      `Bare en kort påminnelse — vi venter fortsatt på priser for ${a.titles.length} titler til annonsøren vi nevnte. Svar gjerne direkte på denne e-posten.`,
      ``,
      `Du kan også legge dem inn her: ${a.link}`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}
function no_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Rett person for prisforespørselen?`,
    text: [
      greeting,
      ``,
      `Vi har prøvd å nå rett person for priser på ${a.titles.length} titler. Om det ikke er deg, kan du peke oss videre — eller bare svare på denne e-posten?`,
      ``,
      `${a.link}`,
      ``,
      `Om dere ikke er interessert, gi gjerne beskjed her: ${a.unsubscribeLink} — så stopper vi videre kontakt.`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}

// ---------- Swedish ----------
function sv_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Prisförfrågan för ${a.titles.length} titlar — annonsör söker native`,
    text: [
      greeting,
      ``,
      `Vi har en annonsör vi vill kolla priser och möjligheter för, och era titlar är aktuella. Vi vill gärna ha en översikt över priser för native och advertorial på:`,
      ``,
      titleLines(a.titles, (n) => `…och ${n} till`),
      ``,
      `Format vi är intresserade av:`,
      `  • Native-artikel / advertorial`,
      `  • Sponsrat innehåll`,
      `  • Brand stories`,
      `  • Video native`,
      `  • Andra format ni erbjuder`,
      ``,
      `Har ni olika rate cards per publikation, skicka gärna alla.`,
      ``,
      `Svara gärna direkt på det här mejlet med rate cards eller priser — det är enklast. Ni kan också lägga in dem här om ni föredrar det:`,
      a.link,
      ``,
      `Om du inte är rätt person att svara på detta, vidarebefordra gärna internt, svara på det här mejlet, eller hör av dig via länken.`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}
function sv_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Re: Prisförfrågan för ${a.titles.length} titlar`,
    text: [
      greeting,
      ``,
      `En kort påminnelse — vi väntar fortfarande på priser för ${a.titles.length} titlar till annonsören vi nämnde. Svara gärna direkt på det här mejlet.`,
      ``,
      `Du kan också lägga in dem här: ${a.link}`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}
function sv_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Rätt person för prisförfrågan?`,
    text: [
      greeting,
      ``,
      `Vi har försökt nå rätt person för priser på ${a.titles.length} titlar. Om det inte är du, kan du peka oss vidare — eller bara svara på det här mejlet?`,
      ``,
      `${a.link}`,
      ``,
      `Om ni inte är intresserade, hör gärna av er här: ${a.unsubscribeLink} — så stoppar vi vidare kontakt.`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}

// ---------- Danish ----------
function da_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Prisforespørgsel for ${a.titles.length} titler — annoncør søger native`,
    text: [
      greeting,
      ``,
      `Vi har en annoncør, vi gerne vil tjekke priser og muligheder for, og jeres titler er relevante. Vi vil gerne have et overblik over priser for native og advertorial på:`,
      ``,
      titleLines(a.titles, (n) => `…og ${n} mere`),
      ``,
      `Formater vi er interesserede i:`,
      `  • Native-artikel / advertorial`,
      `  • Sponsoreret indhold`,
      `  • Brand stories`,
      `  • Video native`,
      `  • Andre formater I tilbyder`,
      ``,
      `Har I forskellige rate cards per publikation, så send gerne alle.`,
      ``,
      `Svar gerne direkte på denne mail med rate cards eller priser — det er nemmest. I kan også lægge dem ind her, hvis I foretrækker det:`,
      a.link,
      ``,
      `Hvis du ikke er rette person til at svare på dette, så videresend gerne internt, svar på denne mail, eller giv os besked via linket.`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}
function da_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Re: Prisforespørgsel for ${a.titles.length} titler`,
    text: [
      greeting,
      ``,
      `En kort påmindelse — vi venter stadig på priser for ${a.titles.length} titler til annoncøren, vi nævnte. Svar gerne direkte på denne mail.`,
      ``,
      `I kan også lægge dem ind her: ${a.link}`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}
function da_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Rette person for prisforespørgslen?`,
    text: [
      greeting,
      ``,
      `Vi har forsøgt at nå rette person for priser på ${a.titles.length} titler. Hvis det ikke er dig, kan du henvise os videre — eller bare svare på denne mail?`,
      ``,
      `${a.link}`,
      ``,
      `Hvis I ikke er interesserede, så giv gerne besked her: ${a.unsubscribeLink} — så stopper vi yderligere kontakt.`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}

// ---------- Finnish ----------
function fi_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Hintapyyntö ${a.titles.length} julkaisulle — mainostaja etsii native-mainontaa`,
    text: [
      greeting,
      ``,
      `Meillä on mainostaja, jolle haluamme selvittää hintoja ja mahdollisuuksia, ja julkaisunne ovat ajankohtaisia. Haluaisimme yleiskuvan native- ja advertoriaali-sisällön hinnoista seuraaville:`,
      ``,
      titleLines(a.titles, (n) => `…ja ${n} muuta`),
      ``,
      `Formaatit, joista olemme kiinnostuneita:`,
      `  • Natiiviartikkeli / advertoriaali`,
      `  • Sponsoroitu sisältö`,
      `  • Brand stories`,
      `  • Video native`,
      `  • Muut tarjoamanne formaatit`,
      ``,
      `Jos teillä on eri hinnastot eri julkaisuille, lähettäkää ne mielellään kaikki.`,
      ``,
      `Vastaa mielellään suoraan tähän sähköpostiin hinnastoilla tai hinnoilla — se on helpointa. Voitte myös syöttää ne tähän, jos haluatte:`,
      a.link,
      ``,
      `Jos et ole oikea henkilö vastaamaan tähän, välitä mielellään sisäisesti, vastaa tähän sähköpostiin tai kerro meille linkin kautta.`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}
function fi_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Re: Hintapyyntö ${a.titles.length} julkaisulle`,
    text: [
      greeting,
      ``,
      `Pieni muistutus — odotamme yhä hintoja ${a.titles.length} julkaisulle mainitsemallemme mainostajalle. Vastaa mielellään suoraan tähän sähköpostiin.`,
      ``,
      `Voitte myös syöttää ne tähän: ${a.link}`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}
function fi_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Oikea henkilö hintapyyntöön?`,
    text: [
      greeting,
      ``,
      `Olemme yrittäneet tavoittaa oikeaa henkilöä hinnoille ${a.titles.length} julkaisussa. Jos se et ole sinä, voitko ohjata meidät eteenpäin — tai vastata suoraan tähän sähköpostiin?`,
      ``,
      `${a.link}`,
      ``,
      `Jos ette ole kiinnostuneita, kertokaa mielellään tästä: ${a.unsubscribeLink} — niin lopetamme yhteydenotot.`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}

// ---------- German ----------
function de_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hallo ${a.recipientName},` : `Hallo,`;
  return {
    subject: `Preisanfrage für ${a.titles.length} Titel — Werbetreibender sucht Native`,
    text: [
      greeting,
      ``,
      `Wir haben einen Werbetreibenden, für den wir Preise und Möglichkeiten prüfen möchten, und Ihre Titel sind relevant. Wir hätten gern einen Überblick über die Preise für Native- und Advertorial-Inhalte für:`,
      ``,
      titleLines(a.titles, (n) => `…und ${n} weitere`),
      ``,
      `Formate, die uns interessieren:`,
      `  • Native-Artikel / Advertorial`,
      `  • Sponsored Content`,
      `  • Brand Stories`,
      `  • Native-Video`,
      `  • Weitere Formate, die Sie anbieten`,
      ``,
      `Falls Sie unterschiedliche Rate-Cards pro Publikation haben, senden Sie gern alle.`,
      ``,
      `Antworten Sie gern direkt auf diese E-Mail mit Rate-Cards oder Preisen — das ist am einfachsten. Sie können sie auch hier eintragen, wenn Sie möchten:`,
      a.link,
      ``,
      `Falls Sie nicht die richtige Ansprechperson sind, leiten Sie diese E-Mail gern intern weiter, antworten Sie darauf oder geben Sie uns über den Link Bescheid.`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}
function de_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hallo ${a.recipientName},` : `Hallo,`;
  return {
    subject: `Re: Preisanfrage für ${a.titles.length} Titel`,
    text: [
      greeting,
      ``,
      `Eine kurze Erinnerung — wir warten weiterhin auf Preise für ${a.titles.length} Titel für den genannten Werbetreibenden. Antworten Sie gern direkt auf diese E-Mail.`,
      ``,
      `Sie können sie auch hier eintragen: ${a.link}`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}
function de_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hallo ${a.recipientName},` : `Hallo,`;
  return {
    subject: `Richtige Ansprechperson für die Preisanfrage?`,
    text: [
      greeting,
      ``,
      `Wir versuchen, die richtige Ansprechperson für Preise zu ${a.titles.length} Titeln zu erreichen. Falls Sie es nicht sind, können Sie uns weiterleiten — oder einfach auf diese E-Mail antworten?`,
      ``,
      `${a.link}`,
      ``,
      `Falls Sie kein Interesse haben, geben Sie uns gern hier Bescheid: ${a.unsubscribeLink} — dann stoppen wir weitere Kontaktaufnahme.`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}

// ---------- English ----------
function en_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hi ${a.recipientName},` : `Hi,`;
  return {
    subject: `Price request for ${a.titles.length} titles — advertiser looking for native`,
    text: [
      greeting,
      ``,
      `We have an advertiser we'd like to check prices and possibilities for, and your titles are relevant. We'd like an overview of prices for native and advertorial content on:`,
      ``,
      titleLines(a.titles, (n) => `…and ${n} more`),
      ``,
      `Formats we're interested in:`,
      `  • Native article / advertorial`,
      `  • Sponsored content`,
      `  • Brand stories`,
      `  • Native video`,
      `  • Other formats you offer`,
      ``,
      `If you have different rate cards per publication, please send them all.`,
      ``,
      `Just reply to this email with rate cards or prices — that's easiest. You can also enter them here if you prefer:`,
      a.link,
      ``,
      `If you're not the right person to answer this, please forward it internally, reply to this email, or let us know via the link.`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}
function en_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hi ${a.recipientName},` : `Hi,`;
  return {
    subject: `Re: Price request for ${a.titles.length} titles`,
    text: [
      greeting,
      ``,
      `A quick nudge — we're still waiting on prices for ${a.titles.length} titles for the advertiser we mentioned. Just reply to this email.`,
      ``,
      `You can also enter them here: ${a.link}`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}
function en_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hi ${a.recipientName},` : `Hi,`;
  return {
    subject: `Right person for the price request?`,
    text: [
      greeting,
      ``,
      `We've been trying to reach the right person for prices on ${a.titles.length} titles. If it's not you, can you point us onward — or just reply to this email?`,
      ``,
      `${a.link}`,
      ``,
      `Not interested? Let us know here: ${a.unsubscribeLink} — and we'll stop reaching out.`,
      ``,
      SIGNATURE,
    ].join("\n"),
  };
}

const BUILDERS: Record<Locale, Record<SequenceStep, (a: BuildArgs) => Built>> = {
  no: { initial: no_initial, bump1: no_bump1, bump2: no_bump2 },
  sv: { initial: sv_initial, bump1: sv_bump1, bump2: sv_bump2 },
  da: { initial: da_initial, bump1: da_bump1, bump2: da_bump2 },
  fi: { initial: fi_initial, bump1: fi_bump1, bump2: fi_bump2 },
  de: { initial: de_initial, bump1: de_bump1, bump2: de_bump2 },
  en: { initial: en_initial, bump1: en_bump1, bump2: en_bump2 },
};

export function buildOutreachEmail(a: BuildArgs): Built {
  const locale = (BUILDERS as Record<string, unknown>)[a.locale] ? a.locale : ("en" as Locale);
  return BUILDERS[locale][a.step](a);
}
