import { z } from "zod";

// Semantic, buyer-safe inclusions (Product.inclusions / PriceQuote.inclusions).
// Structured facts curated from publisher quote text — rendered through i18n
// templates so one data entry serves every locale. Raw quote text (contacts,
// discounts, net figures) must never reach this shape.
export type ProductInclusions = {
  production?: "PLATFORM" | "PUBLISHER" | "ADVERTISER";
  viewsPerWeek?: number;
  viewsPerMonth?: number;
  viewsTotal?: number;
  readsTotal?: number;
  frontpage?: boolean;
  newsletter?: boolean;
  social?: boolean;
  // Named channels beat the generic flag when the offer states them.
  socialChannels?: string[];
  print?: boolean;
  rights?: boolean;
  searchableMonths?: number;
  durationWeeks?: number;
  articles?: number;
  sovPct?: number;
  video?: boolean;
  report?: boolean;
  photographer?: boolean;
  translation?: boolean;
  // Publisher-stated minimum spend / floor for custom or bespoke content
  // (e.g. Schibsted/FT partner content). A gross commercial floor the
  // publisher quotes openly — safe to surface, unlike marked-up net rates.
  minSpend?: number;
};

// Minimal shape next-intl's translator satisfies — avoids importing the
// server-only getTranslations type into a module used by client components.
type Translator = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

// Renders a product's structured inclusions into human sentences via the
// "titleDetail" namespace's inc.* templates. Shared by the title detail
// page's full facts card and the compact /plan line summary — same data,
// same wording, so a buyer never sees the offer described two different
// ways in two places.
export function inclusionLines(
  inc: ProductInclusions | null,
  t: Translator,
  currency: string,
): string[] {
  if (!inc) return [];
  const lines: string[] = [];
  // Min-spend leads: it is the headline commercial fact for bespoke/custom
  // content (Schibsted/FT partner content) and frames every other line.
  if (inc.minSpend)
    lines.push(t("inc.minSpend", { currency, amount: inc.minSpend }));
  if (inc.production === "PLATFORM") lines.push(t("inc.productionPlatform"));
  if (inc.production === "PUBLISHER") lines.push(t("inc.productionPublisher"));
  if (inc.production === "ADVERTISER") lines.push(t("inc.productionAdvertiser"));
  if (inc.viewsPerWeek)
    lines.push(t("inc.viewsPerWeek", { amount: inc.viewsPerWeek }));
  if (inc.viewsPerMonth)
    lines.push(t("inc.viewsPerMonth", { amount: inc.viewsPerMonth }));
  if (inc.viewsTotal)
    lines.push(t("inc.viewsTotal", { amount: inc.viewsTotal }));
  if (inc.readsTotal)
    lines.push(t("inc.readsTotal", { amount: inc.readsTotal }));
  if (inc.articles && inc.articles > 1)
    lines.push(t("inc.articles", { count: inc.articles }));
  if (inc.frontpage) lines.push(t("inc.frontpage"));
  if (inc.sovPct) lines.push(t("inc.sov", { pct: inc.sovPct }));
  if (inc.newsletter) lines.push(t("inc.newsletter"));
  if (inc.socialChannels?.length)
    lines.push(t("inc.socialChannels", { channels: inc.socialChannels.join(", ") }));
  else if (inc.social) lines.push(t("inc.social"));
  if (inc.video) lines.push(t("inc.video"));
  if (inc.photographer) lines.push(t("inc.photographer"));
  if (inc.translation) lines.push(t("inc.translation"));
  if (inc.report) lines.push(t("inc.report"));
  if (inc.print) lines.push(t("inc.print"));
  if (inc.rights) lines.push(t("inc.rights"));
  if (inc.searchableMonths)
    lines.push(t("inc.searchable", { months: inc.searchableMonths }));
  if (inc.durationWeeks)
    lines.push(t("inc.duration", { weeks: inc.durationWeeks }));
  return lines;
}

const positiveInt = z.number().int().positive();

// Strict on purpose: an unknown key is a typo or a fact the renderer can't
// express — reject it at the source instead of storing dead data.
export const inclusionsSchema = z.strictObject({
  production: z.enum(["PLATFORM", "PUBLISHER", "ADVERTISER"]).optional(),
  viewsPerWeek: positiveInt.optional(),
  viewsPerMonth: positiveInt.optional(),
  viewsTotal: positiveInt.optional(),
  readsTotal: positiveInt.optional(),
  frontpage: z.boolean().optional(),
  newsletter: z.boolean().optional(),
  social: z.boolean().optional(),
  socialChannels: z.array(z.string().max(40)).max(10).optional(),
  print: z.boolean().optional(),
  rights: z.boolean().optional(),
  searchableMonths: positiveInt.optional(),
  durationWeeks: positiveInt.optional(),
  articles: positiveInt.optional(),
  sovPct: z.number().int().min(1).max(100).optional(),
  video: z.boolean().optional(),
  report: z.boolean().optional(),
  photographer: z.boolean().optional(),
  translation: z.boolean().optional(),
  minSpend: positiveInt.optional(),
}) satisfies z.ZodType<ProductInclusions>;
