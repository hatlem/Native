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
    case "IE": return "en";
  }
}

export type TitleRef = { name: string; marketCode: MarketCode };

export type BuildArgs = {
  step: SequenceStep;
  locale: Locale;
  recipientName: string | null;
  titles: TitleRef[];
  link: string;
  unsubscribeLink: string;
};

export type Built = { subject: string; text: string };

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
  const subject = `Native-rate cards for ${a.titles.length} av deres titler — buyer-pipeline i NativeSpin`;
  const text = [
    greeting,
    ``,
    `Vi har annonsører som leter etter native- og annonsørinnhold-inventar på tvers av Norden, DACH og UK/IE.`,
    `For å være klar når en konkret henvendelse kommer, trenger vi oppdaterte rate cards for følgende formater:`,
    ``,
    `  • Native artikkel / annonsørinnhold`,
    `  • Sponset innhold`,
    `  • Brand stories`,
    `  • Video native`,
    `  • Andre formater dere tilbyr`,
    ``,
    `Titler dette gjelder:`,
    titleLines(a.titles, (n) => `…og ${n} til — se full liste på lenken`),
    ``,
    `Send oss rate cards (lenken er gyldig i 30 dager):`,
    a.link,
    ``,
    `Hvis dette ikke er riktig kontakt, gjerne videresend internt — eller gi oss beskjed via lenken.`,
    ``,
    `— NativeSpin`,
    ``,
    `Avregistrer fra videre kommunikasjon: ${a.unsubscribeLink}`,
  ].join("\n");
  return { subject, text };
}
function no_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Re: Native-rate cards for ${a.titles.length} titler`,
    text: [
      greeting,
      ``,
      `Bare et kort kakk på døra i tilfelle den forrige e-posten ble begravet.`,
      `Vi venter fortsatt på rate cards for ${a.titles.length} titler — lenken er fortsatt aktiv:`,
      ``,
      a.link,
      ``,
      `— NativeSpin`,
      ``,
      `Avregistrer: ${a.unsubscribeLink}`,
    ].join("\n"),
  };
}
function no_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Riktig kontakt for rate cards?`,
    text: [
      greeting,
      ``,
      `Vi har prøvd å nå rette kontakt for rate cards på ${a.titles.length} titler i NativeSpin-katalogen.`,
      `Hvis det ikke er deg, kan du peke oss til hvem som er?`,
      ``,
      a.link,
      ``,
      `Hvis dere ikke er interessert i å være listet for native i NativeSpin, gi gjerne beskjed her: ${a.unsubscribeLink} — så stopper vi videre kontakt.`,
      ``,
      `— NativeSpin`,
    ].join("\n"),
  };
}

// ---------- Swedish ----------
function sv_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Native-rate cards för ${a.titles.length} av era titlar — buyer-pipeline hos NativeSpin`,
    text: [
      greeting,
      ``,
      `Vi har annonsörer som söker native- och annonsörsinnehåll-inventarier över Norden, DACH och UK/IE.`,
      `För att vara redo när en konkret förfrågan kommer behöver vi aktuella rate cards för följande format:`,
      ``,
      `  • Native artikel / annonsörsinnehåll`,
      `  • Sponsrat innehåll`,
      `  • Brand stories`,
      `  • Video native`,
      `  • Andra format ni erbjuder`,
      ``,
      `Berörda titlar:`,
      titleLines(a.titles, (n) => `…och ${n} till — se hela listan på länken`),
      ``,
      `Skicka rate cards (länken gäller i 30 dagar):`,
      a.link,
      ``,
      `Om detta inte är rätt kontakt: vidarebefordra gärna internt eller hör av er via länken.`,
      ``,
      `— NativeSpin`,
      ``,
      `Avregistrera: ${a.unsubscribeLink}`,
    ].join("\n"),
  };
}
function sv_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Re: Native-rate cards för ${a.titles.length} titlar`,
    text: [greeting, ``, `Snabb påminnelse om förra mejlet — vi väntar fortfarande på rate cards för ${a.titles.length} titlar:`, ``, a.link, ``, `— NativeSpin`, ``, `Avregistrera: ${a.unsubscribeLink}`].join("\n"),
  };
}
function sv_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Rätt kontakt för rate cards?`,
    text: [
      greeting, ``,
      `Vi har försökt nå rätt kontakt för rate cards på ${a.titles.length} titlar i NativeSpin-katalogen. Om det inte är du, kan du peka oss vidare?`,
      ``, a.link, ``,
      `Vill ni inte vara med? Avregistrera här: ${a.unsubscribeLink}.`,
      ``, `— NativeSpin`,
    ].join("\n"),
  };
}

// ---------- Danish ----------
function da_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Native-rate cards for ${a.titles.length} af jeres titler — buyer-pipeline i NativeSpin`,
    text: [
      greeting, ``,
      `Vi har annoncører, der leder efter native- og annoncørindhold-inventar på tværs af Norden, DACH og UK/IE.`,
      `For at være klar når en konkret henvendelse kommer, har vi brug for aktuelle rate cards for følgende formater:`,
      ``,
      `  • Native artikel / annoncørindhold`,
      `  • Sponsoreret indhold`,
      `  • Brand stories`,
      `  • Video native`,
      `  • Andre formater I tilbyder`,
      ``,
      `Berørte titler:`,
      titleLines(a.titles, (n) => `…og ${n} mere — se hele listen på linket`),
      ``,
      `Send os rate cards (linket gælder i 30 dage):`,
      a.link, ``,
      `Hvis dette ikke er rette kontakt, så send det gerne videre internt — eller giv os besked via linket.`,
      ``, `— NativeSpin`, ``,
      `Afmeld: ${a.unsubscribeLink}`,
    ].join("\n"),
  };
}
function da_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Re: Native-rate cards for ${a.titles.length} titler`,
    text: [greeting, ``, `Lille påmindelse — vi venter stadig på rate cards for ${a.titles.length} titler:`, ``, a.link, ``, `— NativeSpin`, ``, `Afmeld: ${a.unsubscribeLink}`].join("\n"),
  };
}
function da_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hej ${a.recipientName},` : `Hej,`;
  return {
    subject: `Rette kontakt for rate cards?`,
    text: [greeting, ``, `Vi har forsøgt at nå rette kontakt for rate cards på ${a.titles.length} titler. Hvis det ikke er dig, kan du henvise os til den rette?`, ``, a.link, ``, `Hvis I ikke er interesserede, så afmeld her: ${a.unsubscribeLink}.`, ``, `— NativeSpin`].join("\n"),
  };
}

// ---------- Finnish ----------
function fi_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Natiivimainonnan hintatiedot ${a.titles.length} julkaisullenne — NativeSpin buyer-pipeline`,
    text: [
      greeting, ``,
      `Meillä on mainostajia, jotka etsivät natiivi- ja mainostajasisältöinventaaria Pohjoismaissa, DACH-alueella ja UK/IE:ssa.`,
      `Jotta voimme olla valmiina kun konkreettinen kysely tulee, tarvitsemme ajantasaiset hinnastot seuraaville formaateille:`,
      ``,
      `  • Natiiviartikkeli / mainostajasisältö`,
      `  • Sponsoroitu sisältö`,
      `  • Brand stories`,
      `  • Video native`,
      `  • Muut tarjoamanne formaatit`,
      ``,
      `Kyseiset julkaisut:`,
      titleLines(a.titles, (n) => `…ja ${n} muuta — koko lista linkin takana`),
      ``,
      `Lähetä hinnastot (linkki on voimassa 30 päivää):`,
      a.link, ``,
      `Jos tämä ei ole oikea yhteyshenkilö, välitäthän sisäisesti — tai kerro meille linkin kautta.`,
      ``, `— NativeSpin`, ``,
      `Peruuta tilaus: ${a.unsubscribeLink}`,
    ].join("\n"),
  };
}
function fi_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Re: Hinnastot ${a.titles.length} julkaisulle`,
    text: [greeting, ``, `Pieni muistutus — odotamme yhä hinnastoja ${a.titles.length} julkaisulle:`, ``, a.link, ``, `— NativeSpin`, ``, `Peruuta: ${a.unsubscribeLink}`].join("\n"),
  };
}
function fi_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hei ${a.recipientName},` : `Hei,`;
  return {
    subject: `Oikea yhteyshenkilö hinnastoille?`,
    text: [greeting, ``, `Olemme yrittäneet tavoittaa oikeaa yhteyshenkilöä hinnastoille ${a.titles.length} julkaisussa. Jos se ei ole sinä, voitko ohjata meidät eteenpäin?`, ``, a.link, ``, `Jos ette ole kiinnostuneita, peruuta tilaus: ${a.unsubscribeLink}.`, ``, `— NativeSpin`].join("\n"),
  };
}

// ---------- German ----------
function de_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hallo ${a.recipientName},` : `Hallo,`;
  return {
    subject: `Native-Rate-Cards für ${a.titles.length} Ihrer Titel — Buyer-Pipeline bei NativeSpin`,
    text: [
      greeting, ``,
      `Wir haben Werbetreibende, die Native- und Advertorial-Inventar in den Nordics, DACH und UK/IE suchen.`,
      `Um bereit zu sein, wenn eine konkrete Anfrage kommt, brauchen wir aktuelle Rate-Cards für folgende Formate:`,
      ``,
      `  • Native-Artikel / Advertorial`,
      `  • Sponsored Content`,
      `  • Brand Stories`,
      `  • Video-Native`,
      `  • Weitere Formate, die Sie anbieten`,
      ``,
      `Betroffene Titel:`,
      titleLines(a.titles, (n) => `…und ${n} weitere — vollständige Liste über den Link`),
      ``,
      `Rate-Cards senden (Link 30 Tage gültig):`,
      a.link, ``,
      `Falls Sie nicht die richtige Kontaktperson sind, leiten Sie diese E-Mail bitte intern weiter — oder geben Sie uns über den Link Bescheid.`,
      ``, `— NativeSpin`, ``,
      `Abmelden: ${a.unsubscribeLink}`,
    ].join("\n"),
  };
}
function de_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hallo ${a.recipientName},` : `Hallo,`;
  return {
    subject: `Re: Native-Rate-Cards für ${a.titles.length} Titel`,
    text: [greeting, ``, `Kurze Erinnerung — wir warten weiterhin auf Rate-Cards für ${a.titles.length} Titel:`, ``, a.link, ``, `— NativeSpin`, ``, `Abmelden: ${a.unsubscribeLink}`].join("\n"),
  };
}
function de_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hallo ${a.recipientName},` : `Hallo,`;
  return {
    subject: `Richtige Kontaktperson für Rate-Cards?`,
    text: [greeting, ``, `Wir versuchen, den richtigen Ansprechpartner für Rate-Cards von ${a.titles.length} Titeln im NativeSpin-Katalog zu erreichen. Falls Sie nicht zuständig sind, können Sie uns weiterleiten?`, ``, a.link, ``, `Falls Sie kein Interesse haben, hier abmelden: ${a.unsubscribeLink}.`, ``, `— NativeSpin`].join("\n"),
  };
}

// ---------- English ----------
function en_initial(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hi ${a.recipientName},` : `Hi,`;
  return {
    subject: `Native rate cards for ${a.titles.length} of your titles — NativeSpin buyer-pipeline`,
    text: [
      greeting, ``,
      `We have advertisers looking for native and advertorial inventory across the Nordics, DACH, and UK/IE.`,
      `To be ready when a concrete brief lands, we need current rate cards for the following formats:`,
      ``,
      `  • Native article / advertorial`,
      `  • Sponsored content`,
      `  • Brand stories`,
      `  • Native video`,
      `  • Other formats you offer`,
      ``,
      `Titles involved:`,
      titleLines(a.titles, (n) => `…and ${n} more — see the full list at the link`),
      ``,
      `Send us rate cards (link valid for 30 days):`,
      a.link, ``,
      `If you're not the right contact, please forward internally — or let us know via the link.`,
      ``, `— NativeSpin`, ``,
      `Unsubscribe: ${a.unsubscribeLink}`,
    ].join("\n"),
  };
}
function en_bump1(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hi ${a.recipientName},` : `Hi,`;
  return {
    subject: `Re: Rate cards for ${a.titles.length} titles`,
    text: [greeting, ``, `Quick nudge in case the last email got buried — we're still waiting on rate cards for ${a.titles.length} titles:`, ``, a.link, ``, `— NativeSpin`, ``, `Unsubscribe: ${a.unsubscribeLink}`].join("\n"),
  };
}
function en_bump2(a: BuildArgs): Built {
  const greeting = a.recipientName ? `Hi ${a.recipientName},` : `Hi,`;
  return {
    subject: `Right contact for rate cards?`,
    text: [greeting, ``, `We've been trying to reach the right contact for rate cards on ${a.titles.length} titles in the NativeSpin catalogue. If it's not you, can you point us to who is?`, ``, a.link, ``, `Not interested? Unsubscribe here: ${a.unsubscribeLink}.`, ``, `— NativeSpin`].join("\n"),
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
