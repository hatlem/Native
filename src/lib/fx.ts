// Buyer-facing EUR estimate for multi-market campaign size. NEVER used
// for firm pricing — quotes, invoices and publisher payments stay in
// local currency. This module only feeds the "Approx. €X at today's
// rate" line on the Plan basket and the multi-quote Request page.
//
// Rates come from Market.fxToEUR (1 local unit = X EUR). NULL or
// undefined means the currency is already EUR — caller passes the
// amount through unchanged. Negative or zero rates are treated as
// missing data and the value is dropped from the EUR sum, so a
// half-populated rate table never silently outputs €0.

export type EurEstimate = {
  /** Whole-EUR rounded total of converted amounts. */
  amount: number;
  /** True if at least one input amount was dropped due to a missing
   *  or zero/negative rate. Caller can use this to soften the copy
   *  ("approx. €X+" instead of "approx. €X"). */
  partial: boolean;
};

// Convert a single amount in local currency to EUR. `rate` is 1 local
// = X EUR (as stored on Market.fxToEUR). A null/undefined rate means
// the amount is already in EUR.
export function convertToEur(
  amount: number,
  rate: number | null | undefined,
): number | null {
  if (rate === null || rate === undefined) return amount;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return amount * rate;
}

// Sum a list of (amount, currency) pairs into EUR using a currency →
// rate map. Currencies not in the map and not already EUR are dropped
// and the result is flagged `partial: true`.
export function sumInEur(
  amounts: { amount: number; currency: string }[],
  rateByCurrency: Map<string, number | null>,
): EurEstimate {
  let total = 0;
  let partial = false;
  for (const a of amounts) {
    if (a.currency === "EUR") {
      total += a.amount;
      continue;
    }
    if (!rateByCurrency.has(a.currency)) {
      partial = true;
      continue;
    }
    const converted = convertToEur(a.amount, rateByCurrency.get(a.currency));
    if (converted === null) {
      partial = true;
      continue;
    }
    total += converted;
  }
  return { amount: Math.round(total), partial };
}

// True only when the buyer would actually benefit from a EUR roll-up —
// i.e. the basket touches more than one currency. A single-currency
// basket already shows one clean number; doubling it with an EUR
// estimate is just noise.
export function shouldShowEurEstimate(currencies: string[]): boolean {
  const unique = new Set(currencies);
  return unique.size > 1;
}
