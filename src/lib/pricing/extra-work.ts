import { z } from "zod";

// Extra work: what NativeSpin bills per hour beyond an article's included
// scope (an extra revision round, an interview, images). The rate is desk
// data, one per billing currency (ExtraWorkRate, SUPERADMIN-edited on
// /desk/content-fees); the buyer sees it wherever the article fee is
// explained (lib/article-scope.ts), and the desk bills hours against it on a
// draft quote (EXTRA_WORK line) or an order (OrderExtraWork).
//
// Pure: no DB, so the rules unit-test without Prisma.

export type ExtraWorkRateSpec = { currency: string; hourlyRate: number };

// The agreed rates (2026-09-30), seeded by migration
// 20261001010000_extra_work_hourly. The table is the source of truth once
// seeded; these are the defaults it starts from, not a fallback: a currency
// with no row has no rate (the copy then says "billed per hour" without a
// figure, and the desk can't bill hours in it until SUPERADMIN sets one).
export const DEFAULT_EXTRA_WORK_RATES: readonly ExtraWorkRateSpec[] = [
  { currency: "NOK", hourlyRate: 1650 },
  { currency: "EUR", hourlyRate: 140 },
  { currency: "SEK", hourlyRate: 1600 },
  { currency: "DKK", hourlyRate: 1050 },
  { currency: "GBP", hourlyRate: 120 },
  { currency: "CHF", hourlyRate: 130 },
];

/** The hourly rate billed in `currency`, or null when none is set. */
export function extraWorkHourlyRate(rates: readonly ExtraWorkRateSpec[], currency: string): number | null {
  const code = currency.trim().toUpperCase();
  const rate = rates.find((r) => r.currency.toUpperCase() === code);
  return rate && rate.hourlyRate > 0 ? rate.hourlyRate : null;
}

/**
 * hours × rate as a customer amount. Whole currency units, like every other
 * line (formatMoney prints none, and quote totals round to whole units), so
 * the line can never show a figure that disagrees with the sum it adds to.
 */
export function extraWorkLineTotal(hours: number, hourlyRate: number): number {
  return Math.round(hours * hourlyRate);
}

// Quarter-hour steps: fine enough for a revision round, coarse enough that
// "1.33 h" never reaches an invoice. 200 h is far beyond any real article's
// extra work, so a bigger figure is a typo (an amount typed into hours).
export const EXTRA_WORK_MAX_HOURS = 200;
export const EXTRA_WORK_DESCRIPTION_MAX = 200;

const hoursField = z
  .string()
  .trim()
  // "1,5" and "1.5" alike: the desk types in its own locale.
  // (Number("") is 0 and Number("x") NaN: both fail the number rules.)
  .transform((s) => Number(s.replace(",", ".")))
  .pipe(
    z
      .number()
      .positive()
      .max(EXTRA_WORK_MAX_HOURS)
      .refine((n) => Number.isInteger(n * 4), "quarter-hours"),
  );

export const extraWorkInputSchema = z.object({
  hours: hoursField,
  description: z.string().trim().min(1).max(EXTRA_WORK_DESCRIPTION_MAX),
});

export type ExtraWorkInput = z.infer<typeof extraWorkInputSchema>;

export function parseExtraWorkInput(
  raw: { hours: unknown; description: unknown },
): { ok: true; value: ExtraWorkInput } | { ok: false } {
  const parsed = extraWorkInputSchema.safeParse({
    hours: typeof raw.hours === "string" ? raw.hours : "",
    description: typeof raw.description === "string" ? raw.description : "",
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

// A rate SUPERADMIN types on /desk/content-fees: a positive amount in whole
// or hundredths, capped so a stray extra digit can't publish a six-figure
// hourly rate to every buyer.
export const EXTRA_WORK_RATE_MAX = 100_000;

export const hourlyRateSchema = z
  .string()
  .trim()
  .transform((s) => Number(s.replace(/\s/g, "").replace(",", ".")))
  .pipe(z.number().positive().max(EXTRA_WORK_RATE_MAX))
  .transform((n) => Math.round(n * 100) / 100);

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);
