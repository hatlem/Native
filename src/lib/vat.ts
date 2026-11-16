// Which VAT a sale carries, decided by WHO BUYS — not by where the ad runs.
//
// NativeSpin's seller of record is a Norwegian company selling advertising
// services (remotely deliverable services) to businesses. The rules encoded
// here are the standard ones for that case:
//
//   buyer established in Norway      → Norwegian standard rate, DOMESTIC
//   buyer established anywhere else  → 0 %, REVERSE_CHARGE: the recipient
//                                      accounts for VAT in its own country
//                                      (EU: Art. 196 of Directive 2006/112/EC;
//                                      Norway: export of remotely deliverable
//                                      services, merverdiavgiftsloven § 6-22)
//   buyer country unknown            → DOMESTIC at the standard rate. Charging
//                                      VAT that turns out not to be due can be
//                                      credited; not charging VAT that was due
//                                      cannot be recovered from the customer.
//
// The publication's market never decides the rate: a German title bought by a
// Norwegian advertiser is a Norwegian domestic sale.
//
// ACCOUNTANT CHECK: the rates and the two notes below are the single place
// they live. Have an accountant confirm them before the first cross-border
// invoice is issued (in particular the wording of the notes, and whether any
// buyer country needs a local registration instead of reverse charge).
//
// The result is stored on the Quote and copied to the Invoice, so an issued
// document keeps the treatment it was sold under. Rows from before this
// module have a null treatment and keep their stored vatPct untouched.
//
// Pure module: no DB, no env reads.

export type VatTreatment = "DOMESTIC" | "REVERSE_CHARGE";

// Standard VAT rate charged on domestic sales, per seller country.
export const DOMESTIC_VAT_RATE_PCT: Record<string, number> = {
  NO: 25,
};

export const DEFAULT_SELLER_COUNTRY = "NO";

// EU member states (ISO 3166-1 alpha-2). Northern Ireland ("XI") follows EU
// rules for goods only, so it is not listed for services.
const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE",
]);

// The legal text printed on the document. Kept in English on purpose: it is
// a tax statement read by the recipient's accountant and tax authority, and
// it is stored verbatim on the quote and invoice so it never changes.
export const VAT_NOTE_REVERSE_CHARGE_EU =
  "Reverse charge — VAT to be accounted for by the recipient (Art. 196, Council Directive 2006/112/EC).";
export const VAT_NOTE_REVERSE_CHARGE_NON_EU =
  "Reverse charge — services supplied to a business outside Norway; no Norwegian VAT is charged (merverdiavgiftsloven § 6-22). The recipient accounts for any VAT due in its own country.";

export type VatWarning =
  // No home country on the buyer: the domestic rate was applied as the safe
  // default. The desk should confirm the country before sending.
  | "BUYER_COUNTRY_UNKNOWN"
  // Reverse charge without a VAT id on file: the invoice should carry the
  // recipient's VAT id, so the desk should collect it first.
  | "BUYER_VAT_ID_MISSING";

export type VatDecision = {
  vatPct: number;
  treatment: VatTreatment;
  // Printed on the quote and the invoice; null for a domestic sale.
  note: string | null;
  warnings: VatWarning[];
};

// MarketCode ("UK") and loose spellings → ISO 3166-1 alpha-2, or null.
export function normalizeCountry(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toUpperCase();
  if (!v) return null;
  if (v === "UK") return "GB";
  if (v === "NORWAY" || v === "NORGE" || v === "NOR") return "NO";
  return /^[A-Z]{2}$/.test(v) ? v : null;
}

export function isEuCountry(country: string | null | undefined): boolean {
  const c = normalizeCountry(country);
  return c !== null && EU_COUNTRIES.has(c);
}

export function domesticVatRatePct(sellerCountry?: string | null): number {
  const seller = normalizeCountry(sellerCountry) ?? DEFAULT_SELLER_COUNTRY;
  return DOMESTIC_VAT_RATE_PCT[seller] ?? DOMESTIC_VAT_RATE_PCT[DEFAULT_SELLER_COUNTRY];
}

export function resolveVat(input: {
  // Seller's country (lib/seller.ts); defaults to Norway.
  sellerCountry?: string | null;
  // Buyer's home country — Organization.marketCode, the legal entity's market.
  buyerCountry: string | null | undefined;
  // Buyer's VAT id / organisation number, as entered.
  buyerVatId?: string | null;
}): VatDecision {
  const seller = normalizeCountry(input.sellerCountry) ?? DEFAULT_SELLER_COUNTRY;
  const buyer = normalizeCountry(input.buyerCountry);
  const domesticRate = domesticVatRatePct(seller);

  if (buyer === null) {
    return {
      vatPct: domesticRate,
      treatment: "DOMESTIC",
      note: null,
      warnings: ["BUYER_COUNTRY_UNKNOWN"],
    };
  }
  if (buyer === seller) {
    return { vatPct: domesticRate, treatment: "DOMESTIC", note: null, warnings: [] };
  }
  const hasVatId = Boolean((input.buyerVatId ?? "").trim());
  return {
    vatPct: 0,
    treatment: "REVERSE_CHARGE",
    note: EU_COUNTRIES.has(buyer) ? VAT_NOTE_REVERSE_CHARGE_EU : VAT_NOTE_REVERSE_CHARGE_NON_EU,
    warnings: hasVatId ? [] : ["BUYER_VAT_ID_MISSING"],
  };
}

// The buyer fields a caller loads to decide VAT.
export type VatBuyer = { marketCode?: string | null; vatId?: string | null };

// Convenience over resolveVat for an Organization row.
export function vatForBuyer(
  buyer: VatBuyer | null | undefined,
  sellerCountry?: string | null,
): VatDecision {
  return resolveVat({
    sellerCountry,
    buyerCountry: buyer?.marketCode ?? null,
    buyerVatId: buyer?.vatId ?? null,
  });
}

// What a quote stores about its VAT, re-read for the desk: the warnings are
// derived again from the live buyer, since they describe what is still
// missing rather than what was sold.
export function vatWarningsForBuyer(
  buyer: VatBuyer | null | undefined,
  sellerCountry?: string | null,
): VatWarning[] {
  return vatForBuyer(buyer, sellerCountry).warnings;
}

// VAT amount and gross total for a net subtotal, in exact minor-unit
// (integer) arithmetic so the stated rate always reconciles:
//   vat   = round(subtotal × rate, 2)   (half away from zero)
//   total = subtotal + vat
// Floats never multiply here: both operands are scaled to integers first.
export function vatAmounts(
  subtotal: number,
  vatPct: number,
): { subtotal: number; vat: number; total: number } {
  const subMinor = Math.round(subtotal * 100);
  const rateBp = Math.round(vatPct * 100); // 25 % → 2500 basis points
  const product = subMinor * rateBp; // exact: both integers
  const sign = product < 0 ? -1 : 1;
  const vatMinor = sign * Math.floor((Math.abs(product) + 5000) / 10000);
  return {
    subtotal: subMinor / 100,
    vat: vatMinor / 100,
    total: (subMinor + vatMinor) / 100,
  };
}
