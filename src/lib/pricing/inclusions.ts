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
};

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
}) satisfies z.ZodType<ProductInclusions>;
