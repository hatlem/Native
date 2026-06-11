import type { MarketCode } from "@prisma/client";
import { emailAdapter } from "@/lib/notify";

type Locale = "en" | "no" | "sv" | "da" | "fi" | "de";

export function localeForMarketCode(code: MarketCode): Locale {
  switch (code) {
    case "NO":
      return "no";
    case "SE":
      return "sv";
    case "DK":
      return "da";
    case "FI":
      return "fi";
    case "DE":
    case "AT":
    case "CH":
      return "de";
    case "UK":
    case "IE":
    // NL/BE have no own locale yet — English serves those markets.
    case "NL":
    case "BE":
      return "en";
  }
}

type EmailArgs = {
  locale: Locale;
  contactName: string;
  titleName: string;
  publisherName: string;
  link: string;
  inviterName: string;
  ttlDays?: number;
};

type Built = { subject: string; text: string };

function en(a: EmailArgs): Built {
  return {
    subject: `Price check: ${a.titleName}`,
    text: [
      `Hi ${a.contactName},`,
      ``,
      `${a.inviterName} at NativeSpin is keeping our catalog pricing for ${a.titleName} (${a.publisherName}) up to date.`,
      ``,
      `Could you confirm your current native rates? It takes ~2 minutes:`,
      a.link,
      ``,
      `Or — just hit reply with your latest rates and what's included. We'll log it for you.`,
      ``,
      `Link is good for ${a.ttlDays ?? 30} days.`,
      ``,
      `Thanks,`,
      `${a.inviterName} / NativeSpin`,
    ].join("\n"),
  };
}

function no(a: EmailArgs): Built {
  return {
    subject: `Prisjekk: ${a.titleName}`,
    text: [
      `Hei ${a.contactName},`,
      ``,
      `${a.inviterName} fra NativeSpin holder katalogprisene for ${a.titleName} (${a.publisherName}) oppdatert.`,
      ``,
      `Kan du bekrefte gjeldende native-priser? Tar omtrent 2 minutter:`,
      a.link,
      ``,
      `Eller — svar på denne e-posten med priser og hva som inngår, så logger vi det for deg.`,
      ``,
      `Lenken er gyldig i ${a.ttlDays ?? 30} dager.`,
      ``,
      `Takk,`,
      `${a.inviterName} / NativeSpin`,
    ].join("\n"),
  };
}

function sv(a: EmailArgs): Built {
  return {
    subject: `Priskontroll: ${a.titleName}`,
    text: [
      `Hej ${a.contactName},`,
      ``,
      `${a.inviterName} på NativeSpin håller katalogpriserna för ${a.titleName} (${a.publisherName}) aktuella.`,
      ``,
      `Kan du bekräfta era nuvarande native-priser? Tar ungefär 2 minuter:`,
      a.link,
      ``,
      `Eller — svara på det här mejlet med priser och vad som ingår, så loggar vi det åt dig.`,
      ``,
      `Länken är giltig i ${a.ttlDays ?? 30} dagar.`,
      ``,
      `Tack,`,
      `${a.inviterName} / NativeSpin`,
    ].join("\n"),
  };
}

function da(a: EmailArgs): Built {
  return {
    subject: `Pristjek: ${a.titleName}`,
    text: [
      `Hej ${a.contactName},`,
      ``,
      `${a.inviterName} fra NativeSpin holder katalogpriserne for ${a.titleName} (${a.publisherName}) opdaterede.`,
      ``,
      `Kan du bekræfte jeres aktuelle native-priser? Det tager ca. 2 minutter:`,
      a.link,
      ``,
      `Eller — svar på denne mail med priser og hvad der er inkluderet, så logger vi det for dig.`,
      ``,
      `Linket gælder i ${a.ttlDays ?? 30} dage.`,
      ``,
      `Tak,`,
      `${a.inviterName} / NativeSpin`,
    ].join("\n"),
  };
}

function fi(a: EmailArgs): Built {
  return {
    subject: `Hintatarkistus: ${a.titleName}`,
    text: [
      `Hei ${a.contactName},`,
      ``,
      `${a.inviterName} NativeSpinlta pitää luettelohinnat ajan tasalla julkaisulle ${a.titleName} (${a.publisherName}).`,
      ``,
      `Voitko vahvistaa nykyiset natiivimainonnan hinnat? Vie noin 2 minuuttia:`,
      a.link,
      ``,
      `Tai — vastaa tähän viestiin nykyisillä hinnoilla ja sisällöllä, niin kirjaamme ne puolestasi.`,
      ``,
      `Linkki on voimassa ${a.ttlDays ?? 30} päivää.`,
      ``,
      `Kiitos,`,
      `${a.inviterName} / NativeSpin`,
    ].join("\n"),
  };
}

function de(a: EmailArgs): Built {
  return {
    subject: `Preisabfrage: ${a.titleName}`,
    text: [
      `Hallo ${a.contactName},`,
      ``,
      `${a.inviterName} bei NativeSpin hält die Katalogpreise für ${a.titleName} (${a.publisherName}) aktuell.`,
      ``,
      `Können Sie Ihre aktuellen Native-Preise bestätigen? Dauert etwa 2 Minuten:`,
      a.link,
      ``,
      `Oder — antworten Sie einfach auf diese E-Mail mit Preisen und Leistungsumfang. Wir tragen es für Sie ein.`,
      ``,
      `Der Link ist ${a.ttlDays ?? 30} Tage gültig.`,
      ``,
      `Danke,`,
      `${a.inviterName} / NativeSpin`,
    ].join("\n"),
  };
}

export function buildPriceRequestEmail(args: EmailArgs): Built {
  switch (args.locale) {
    case "no":
      return no(args);
    case "sv":
      return sv(args);
    case "da":
      return da(args);
    case "fi":
      return fi(args);
    case "de":
      return de(args);
    case "en":
    default:
      return en(args);
  }
}

export async function sendPriceRequestEmail(
  args: { to: string; replyTo?: string } & EmailArgs,
): Promise<void> {
  const built = buildPriceRequestEmail(args);
  await emailAdapter({
    to: args.to,
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    subject: built.subject,
    text: built.text,
  });
}
