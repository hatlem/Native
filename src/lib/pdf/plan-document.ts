import { createTranslator, type AbstractIntlMessages } from "next-intl";
import { safeLocale, type AppLocale } from "@/i18n/routing";
import type { SharedList } from "@/lib/list-share";
import { formatMoney, intlLocale } from "@/lib/money";
import { parseTiming, planBriefValues } from "@/lib/plan-brief";
import {
  estimateListTotals,
  hasFigure,
  hasUnpricedLines,
  lineDisplay,
  type LineDisplay,
  type PlanPricing,
} from "@/lib/plan-total";
import { lineBreakdown, type Translate } from "@/lib/plan-line-text";
import { lineFigureLabel, totalLabel } from "@/lib/pricing/total-label";
import { publisherCanWrite } from "@/lib/authorship";
import { formatRunRange, runBounds } from "@/lib/run-period";
import { localizeVertical } from "@/lib/taxonomy-i18n";
import { titleDisplayName } from "@/lib/title-display";
import { zonedDateString } from "@/lib/time-zone";
import daMessages from "@/messages/da.json";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import fiMessages from "@/messages/fi.json";
import noMessages from "@/messages/no.json";
import svMessages from "@/messages/sv.json";

// The downloadable plan (PDF and Word): what a buyer forwards to a colleague
// or a manager who may have no NativeSpin login, or what the client saves from
// the share page. It has to stand on its own, and it must never disagree with
// the screen it was downloaded from, so every figure comes from the helpers
// those pages use: lineDisplay decides exact vs band vs rate vs on request,
// lineFigureLabel words it, lineBreakdown explains an exact line,
// estimateListTotals + totalLabel make the total. A line the page shows as a
// band carries only its band here too: this model never holds the estimate
// behind it, so neither renderer can print it.
//
// Pure and DB-free: the routes load the list (lib/pdf/plan-download.ts), this
// turns it into printable strings, and PlanDocument.tsx / plan-docx.ts lay the
// same strings out, so the PDF and the Word file say exactly the same thing.

const MESSAGES = { da: daMessages, de: deMessages, en: enMessages, fi: fiMessages, no: noMessages, sv: svMessages };

// Loosely keyed on purpose: the shared line helpers take any namespace's
// translator (lib/plan-line-text.ts Translate). The key checks the typed JSON
// would give are covered by the message-keys and locale-parity tests.
function translator(locale: AppLocale, namespace: string): Translate {
  const messages = MESSAGES[locale] as unknown as AbstractIntlMessages;
  return createTranslator({ locale, messages, namespace }) as Translate;
}

export type PlanDocumentAudience =
  // The owning org's team, downloading from /plan: includes the brief.
  | "team"
  // Whoever holds the share link: exactly what the share page shows.
  | "client";

// The plan's brief columns (SavedList), for the team's copy only: the share
// page never shows the brief (the budget is the buyer's own business).
export type PlanDocumentBrief = {
  briefText: string | null;
  briefTiming: string | null;
  budget: unknown;
  currency: string | null;
  targetAudience: string | null;
  targetGeo: string | null;
  targetContext: string | null;
  targetVerticals: string | null;
};

export type PlanDocumentInput = {
  list: SharedList;
  brief: PlanDocumentBrief | null;
  pricing: PlanPricing;
  locale: string;
  audience: PlanDocumentAudience;
  // Where the live plan is: the share URL when the plan has an active share
  // link (opens without a login), otherwise the plan's own address.
  link: { kind: "share" | "plan"; url: string };
  generatedAt: Date;
  // The org market's zone: the date on the document is the org's calendar day.
  timeZone: string;
};

export type PlanDocumentRow = {
  itemId: string;
  // The page's own display decision for the line; null for a title with no
  // placement yet. Kept so tests can hold the document to the page's model.
  display: LineDisplay | null;
  title: string;
  subtitle: string;
  // Quantity, who writes the article, the booked run.
  details: string | null;
  note: string | null;
  reach: string;
  price: string;
  // What the price covers: an exact line's split, or "incl. article" on a band.
  priceDetail: string | null;
  // Instant-orderable: the one kind of figure set in bold, like the offers.
  firm: boolean;
  status: string;
};

export type PlanDocumentSection = {
  key: "plan" | "alternatives";
  heading: string;
  intro: string | null;
  rows: PlanDocumentRow[];
};

export type PlanDocumentTotal = {
  currency: string;
  figure: string;
  notes: string[];
};

export type PlanDocument = {
  locale: AppLocale;
  documentTitle: string;
  eyebrow: string;
  planName: string;
  meta: string;
  waveNote: string | null;
  intro: string;
  link: { lead: string; url: string; invite: string | null };
  brief: { heading: string; entries: { label: string; value: string }[] } | null;
  columns: { publication: string; reach: string; price: string; status: string };
  noteLabel: string;
  sections: PlanDocumentSection[];
  total: { heading: string; label: string; rows: PlanDocumentTotal[]; empty: string | null; notes: string[] };
  prices: { heading: string; lines: string[] };
  footer: { org: string; linkLabel: string; pageOf: string };
  // "NativeSpin – <plan name> – <YYYY-MM-DD>", without the extension.
  filename: string;
};

type Item = SharedList["items"][number];

// Characters no file system (or mail client) takes in a name, plus control
// characters; the plan name is the buyer's own free text.
const UNSAFE_FILENAME = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const FILENAME_NAME_MAX = 80;

export function planDocumentFilename(planName: string, generatedAt: Date, timeZone: string): string {
  const name = planName
    .replace(UNSAFE_FILENAME, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FILENAME_NAME_MAX)
    .replace(/[.\s]+$/, "");
  const date = zonedDateString(generatedAt, timeZone);
  return name ? `NativeSpin – ${name} – ${date}` : `NativeSpin – ${date}`;
}

export function buildPlanDocument(input: PlanDocumentInput): PlanDocument {
  const { list, pricing, audience } = input;
  const locale = safeLocale(input.locale);
  const td = translator(locale, "planDocument");
  const tPlan = translator(locale, "plan");
  const tShare = translator(locale, "shareList");
  const tv = translator(locale, "priceVisibility");
  const tType = translator(locale, "productType");
  const tSeg = translator(locale, "targetSegment");
  const number = new Intl.NumberFormat(intlLocale(locale));
  const money = (amount: number, currency: string) => formatMoney(amount, currency, locale);
  const date = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeZone: input.timeZone }).format(
    input.generatedAt,
  );
  const priceOnRequest = td("priceOnRequest");

  const row = (i: Item, inPlan: boolean): PlanDocumentRow | null => {
    if (i.productId && i.product) {
      const p = i.product;
      const display = lineDisplay(i, pricing);
      const canWrite = publisherCanWrite(p);
      const reach = p.title.digitalReach ?? p.title.monthlyReach ?? null;
      // What the plan lines and the share page say about a line in the plan;
      // an alternative is shown bare, as on both pages.
      const details = inPlan
        ? [
            i.quantity > 1 ? tShare("qty", { count: i.quantity }) : null,
            i.withContent ? tShare("weWriteIt") : canWrite ? tShare("publisherWritesIt") : null,
            i.scheduleStart
              ? tPlan("runPeriod", {
                  range: formatRunRange(i.scheduleStart, i.scheduleUnits, p.bookingUnit, locale),
                  n: runBounds(i.scheduleStart, i.scheduleUnits, p.bookingUnit).units,
                  unit: p.bookingUnit,
                })
              : null,
          ].filter(Boolean)
        : [];
      const priceDetail =
        display.kind === "exact"
          ? lineBreakdown(
              { display, quantity: i.quantity, withContent: i.withContent, publisherCanWrite: canWrite, currency: p.currency },
              locale,
              tPlan,
              tv,
            ) || null
          : display.kind === "band" && display.withContent
            ? tv("productionIncluded")
            : null;
      return {
        itemId: i.id,
        display,
        title: titleDisplayName(p.title),
        subtitle: `${tType(p.type)} · ${p.title.publisher.name}`,
        details: details.length ? details.join(" · ") : null,
        note: i.notes,
        reach: reach ? td("reachValue", { count: number.format(reach) }) : "–",
        price: lineFigureLabel(display, p.currency, locale, priceOnRequest),
        priceDetail,
        firm: display.kind === "exact",
        status:
          display.kind === "exact"
            ? td("statusExact")
            : display.kind === "onRequest"
              ? td("statusOnRequest")
              : tv("listIndicative"),
      };
    }
    // A title the buyer asked for with no placement yet: the desk proposes
    // and prices one.
    if (!i.title) return null;
    return {
      itemId: i.id,
      display: null,
      title: titleDisplayName(i.title),
      subtitle: `${i.title.publisher.name} · ${tShare("placementTbd")}`,
      details: null,
      note: i.notes,
      reach: "–",
      price: priceOnRequest,
      priceDetail: null,
      firm: false,
      status: td("statusPlaceholder"),
    };
  };

  const rowsOf = (items: Item[], inPlan: boolean) =>
    items.map((i) => row(i, inPlan)).filter((r): r is PlanDocumentRow => r !== null);
  const planItems = list.items.filter((i) => !i.isAlternative);
  const altItems = list.items.filter((i) => i.isAlternative);
  const sections: PlanDocumentSection[] = [
    { key: "plan", heading: td("planHeading"), intro: null, rows: rowsOf(planItems, true) },
  ];
  if (altItems.length > 0) {
    sections.push({
      key: "alternatives",
      heading: tShare("alternativesHeading"),
      // The team's copy explains the alternatives the way /plan does ("until
      // you add them"); the client's the way the share page does.
      intro: audience === "team" ? tPlan("alternativesIntro") : tShare("alternativesIntro"),
      rows: rowsOf(altItems, false),
    });
  }

  // The total exactly as /plan's summary and the share page print it: the
  // currencies with a figure, each "exact + ≈ band" excl. VAT, the content-fee
  // split and the VAT-inclusive figure of the exact part only.
  const allTotals = estimateListTotals(list.items, pricing);
  const totals = allTotals.filter(hasFigure);
  const totalNotes = [
    hasUnpricedLines(list.items, allTotals) && totals.length > 0 ? tv("plusOnRequest") : null,
    totals.some((r) => r.estimate !== null) ? tPlan("estimateNote") : null,
    totals.length > 1 ? tPlan("multiCurrencyNote") : null,
  ].filter((n): n is string => n !== null);

  const allRows = sections.flatMap((s) => s.rows);
  const has = (kind: LineDisplay["kind"] | "placeholder") =>
    allRows.some((r) => (r.display ? r.display.kind === kind : kind === "placeholder"));
  const currencies = [...new Set(list.items.flatMap((i) => (i.product ? [i.product.currency] : [])))];
  const pricesLines = [
    currencies.length
      ? td("pricesVat", {
          currencies: new Intl.ListFormat(intlLocale(locale), { type: "conjunction" }).format(currencies),
        })
      : null,
    has("exact") ? td("pricesExact", { label: td("statusExact") }) : null,
    has("band") || has("rate") ? td("pricesIndicative", { label: tv("listIndicative") }) : null,
    has("onRequest") || has("placeholder") ? td("pricesOnRequest", { label: priceOnRequest }) : null,
    planItems.some((i) => i.product && (i.withContent || publisherCanWrite(i.product)))
      ? td("pricesContent", { label: tShare("weWriteIt") })
      : null,
    altItems.length > 0 ? td("pricesAlternatives") : null,
    td("pricesNothingBooked"),
  ].filter((l): l is string => l !== null);

  const waveNote =
    list.programme && list.waveNumber
      ? `${tShare("waveNote", { n: list.waveNumber, of: list.programme.plannedWaves })}${
          list.article?.title ? ` · ${list.article.title}` : ""
        }`
      : null;

  return {
    locale,
    documentTitle: td("documentTitle", { name: list.name }),
    eyebrow: td("eyebrow"),
    planName: list.name,
    meta: td("preparedFor", { org: list.organization.name, date }),
    waveNote,
    intro: td("intro", { date }),
    link: {
      lead: input.link.kind === "share" ? td("linkShare") : td("linkPlan"),
      url: input.link.url,
      // Only the team can invite; a client's copy always carries the share link.
      invite: input.link.kind === "plan" && audience === "team" ? td("linkInvite") : null,
    },
    brief: audience === "team" && input.brief ? briefSection(input.brief, locale, { td, tPlan, tSeg }) : null,
    columns: {
      publication: td("colPublication"),
      reach: td("colReach"),
      price: td("colPrice"),
      status: td("colStatus"),
    },
    noteLabel: tShare("noteLabel"),
    sections,
    total: {
      heading: td("totalHeading"),
      label: tPlan("estTotal"),
      rows: totals.map((r) => ({
        currency: r.currency,
        figure: `${totalLabel(r, locale)} ${tPlan("exVat")}`,
        notes: [
          r.hasExact && !r.estimate && r.contentFees > 0
            ? tPlan("includesContentFees", { amount: money(r.contentFees, r.currency) })
            : null,
          r.hasExact
            ? r.estimate
              ? tPlan("inclVatFirmPart", { amount: money(r.totalInclVat, r.currency) })
              : tPlan("inclVatLine", { amount: money(r.totalInclVat, r.currency) })
            : null,
        ].filter((n): n is string => n !== null),
      })),
      empty: totals.length === 0 ? priceOnRequest : null,
      notes: totalNotes,
    },
    prices: { heading: td("pricesHeading"), lines: pricesLines },
    // The raw "Page {page} of {pages}" template: the page numbers are only
    // known to the renderer (the PDF's render prop, Word's page fields).
    footer: { org: list.organization.name, linkLabel: td("footerLink"), pageOf: MESSAGES[locale].planDocument.pageOf },
    filename: planDocumentFilename(list.name, input.generatedAt, input.timeZone),
  };
}

// The brief as /plan's brief form holds it (lib/plan-brief.ts planBriefValues),
// in words: only what the buyer filled in, segments and verticals by their
// localized labels, never the stored codes.
function briefSection(
  brief: PlanDocumentBrief,
  locale: AppLocale,
  t: { td: Translate; tPlan: Translate; tSeg: Translate },
): PlanDocument["brief"] {
  const values = planBriefValues(brief);
  const timing = parseTiming(values.briefTiming);
  const budget = values.budget ? Number(values.budget) : null;
  const verticals = (brief.targetVerticals ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const entries = [
    { label: t.td("briefCampaign"), value: values.briefText },
    {
      label: t.td("briefTiming"),
      value: !timing
        ? ""
        : timing.kind === "quarter"
          ? t.tPlan("timing.quarter", { quarter: timing.quarter, year: timing.year })
          : t.tPlan("timing.flexible"),
    },
    {
      label: t.td("briefBudget"),
      value:
        budget === null
          ? ""
          : brief.currency
            ? formatMoney(budget, brief.currency, locale)
            : new Intl.NumberFormat(intlLocale(locale)).format(budget),
    },
    { label: t.td("briefAudience"), value: values.targetAudience.map((s) => t.tSeg(s)).join(", ") },
    { label: t.td("briefGeo"), value: values.targetGeo },
    { label: t.td("briefContext"), value: values.targetContext },
    { label: t.td("briefTargeting"), value: verticals.map((v) => localizeVertical(v, locale)).join(", ") },
  ].filter((e) => e.value.trim() !== "");
  return entries.length ? { heading: t.td("briefHeading"), entries } : null;
}
