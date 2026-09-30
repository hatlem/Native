// NativeSpin's own legal details as the SELLER on every invoice — the one
// place they are defined. Norwegian invoice rules (bokføringsforskriften
// § 5-1-1) require the seller's name, organisation number (with "MVA" when
// VAT-registered — we charge VAT, so we are), and address on every sales
// document; an AS also states "Foretaksregisteret". The payment details are
// what the buyer needs to actually pay: a domestic account for NOK invoices,
// IBAN + BIC for every other currency.
//
// Values come from the environment so ops can correct them without a deploy.
// Only facts the repo itself states have a default — the legal name and seat
// ("Getia AS · Oslo", the site footer and privacy page) and Foretaksregisteret
// for an AS. The organisation number, VAT number, street address, postcode
// and bank details are NOT in the repo and are never guessed: until they are
// set, invoice PDFs refuse to render (sellerGaps) and the desk is told which
// variables are missing.

export type SellerDetails = {
  legalName: string;
  orgNumber: string | null;
  vatNumber: string | null;
  // "Foretaksregisteret" for a Norwegian AS.
  registry: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  bankAccount: string | null;
  iban: string | null;
  bic: string | null;
  email: string | null;
};

// Every variable, for the desk message and .env.example.
export const SELLER_ENV = {
  legalName: "SELLER_LEGAL_NAME",
  orgNumber: "SELLER_ORG_NUMBER",
  vatNumber: "SELLER_VAT_NUMBER",
  registry: "SELLER_REGISTRY",
  addressLine1: "SELLER_ADDRESS_LINE1",
  addressLine2: "SELLER_ADDRESS_LINE2",
  postalCode: "SELLER_POSTAL_CODE",
  city: "SELLER_CITY",
  country: "SELLER_COUNTRY",
  bankAccount: "SELLER_BANK_ACCOUNT",
  iban: "SELLER_IBAN",
  bic: "SELLER_BIC",
  email: "SELLER_EMAIL",
} as const satisfies Record<keyof SellerDetails, string>;

type Env = Record<string, string | undefined>;

function read(env: Env, key: keyof SellerDetails): string | null {
  const v = env[SELLER_ENV[key]]?.trim();
  return v ? v : null;
}

export function loadSellerDetails(env: Env = process.env): SellerDetails {
  return {
    legalName: read(env, "legalName") ?? "Getia AS",
    orgNumber: read(env, "orgNumber"),
    vatNumber: read(env, "vatNumber"),
    registry: read(env, "registry") ?? "Foretaksregisteret",
    addressLine1: read(env, "addressLine1"),
    addressLine2: read(env, "addressLine2"),
    postalCode: read(env, "postalCode"),
    city: read(env, "city") ?? "Oslo",
    country: read(env, "country") ?? "Norway",
    bankAccount: read(env, "bankAccount"),
    iban: read(env, "iban")?.replace(/\s+/g, "").toUpperCase() ?? null,
    bic: read(env, "bic")?.replace(/\s+/g, "").toUpperCase() ?? null,
    email: read(env, "email"),
  };
}

// ---------------------------------------------------------------------------
// Validation — a typo in a bank detail sends a customer's payment nowhere, so
// the formats with a checksum are checked, not just present.
// ---------------------------------------------------------------------------

// Norwegian organisation number: 9 digits, MOD11 check digit (weights 3 2 7 6 5 4 3 2).
export function isValidNorwegianOrgNumber(raw: string): boolean {
  const digits = raw.replace(/\s+/g, "");
  if (!/^\d{9}$/.test(digits)) return false;
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((s, w, i) => s + w * Number(digits[i]), 0);
  const rest = sum % 11;
  const check = rest === 0 ? 0 : 11 - rest;
  return check !== 10 && check === Number(digits[8]);
}

// Norwegian bank account: 11 digits (dots/spaces allowed), MOD11 check digit.
export function isValidNorwegianBankAccount(raw: string): boolean {
  const digits = raw.replace(/[\s.]/g, "");
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((s, w, i) => s + w * Number(digits[i]), 0);
  const rest = sum % 11;
  const check = rest === 0 ? 0 : 11 - rest;
  return check !== 10 && check === Number(digits[10]);
}

// ISO 13616 IBAN: country + check digits + BBAN, mod-97 = 1.
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const n = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

// ISO 9362 BIC: 8 or 11 characters.
export function isValidBic(raw: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(raw.replace(/\s+/g, "").toUpperCase());
}

export type SellerGap = { variable: string; problem: "missing" | "invalid" };

// What stops an invoice in `currency` from being legally complete and
// payable. Empty = render it. A NOK invoice is payable to the domestic
// account (or IBAN); any other currency needs IBAN + BIC.
export function sellerGaps(seller: SellerDetails, currency: string): SellerGap[] {
  const gaps: SellerGap[] = [];
  const need = (key: keyof SellerDetails, valid?: (v: string) => boolean) => {
    const v = seller[key];
    if (typeof v !== "string" || !v) gaps.push({ variable: SELLER_ENV[key], problem: "missing" });
    else if (valid && !valid(v)) gaps.push({ variable: SELLER_ENV[key], problem: "invalid" });
  };
  need("legalName");
  const norwegian = (seller.country ?? "").trim().toLowerCase().match(/^(no|nor|norway|norge)$/) !== null;
  need("orgNumber", norwegian ? isValidNorwegianOrgNumber : undefined);
  need("vatNumber");
  need("addressLine1");
  need("postalCode");
  need("city");
  need("country");

  if (seller.bankAccount && norwegian && !isValidNorwegianBankAccount(seller.bankAccount)) {
    gaps.push({ variable: SELLER_ENV.bankAccount, problem: "invalid" });
  }
  if (seller.iban && !isValidIban(seller.iban)) gaps.push({ variable: SELLER_ENV.iban, problem: "invalid" });
  if (seller.bic && !isValidBic(seller.bic)) gaps.push({ variable: SELLER_ENV.bic, problem: "invalid" });

  if (currency === "NOK") {
    if (!seller.bankAccount && !seller.iban) gaps.push({ variable: SELLER_ENV.bankAccount, problem: "missing" });
  } else {
    if (!seller.iban) gaps.push({ variable: SELLER_ENV.iban, problem: "missing" });
    if (!seller.bic) gaps.push({ variable: SELLER_ENV.bic, problem: "missing" });
  }
  return gaps;
}

// The seller's address block, in print order.
export function sellerAddressLines(seller: SellerDetails): string[] {
  return [
    seller.addressLine1,
    seller.addressLine2,
    [seller.postalCode, seller.city].filter(Boolean).join(" "),
    seller.country,
  ].filter((l): l is string => Boolean(l && l.trim()));
}
