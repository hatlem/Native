// Human label for an invoice line: "Verdens Gang (VG) — Native article"
// rather than the raw product name "Verdens Gang (VG) — NATIVE_ARTICLE".
//
// New lines (issued since the invoice-line snapshot columns exist) carry
// titleName + productType and are labelled from those. Legacy lines only
// have `description`, which is built from Product.name (often
// "<Title> — <ENUM>") and, for content fees, the money.ts
// "Content production — <product name>" convention; those are parsed so
// already-issued invoices read properly too.

import { ProductType } from "@prisma/client";
import { feePlacementDescription } from "@/lib/commerce/placements";

export type LabelledInvoiceLine = {
  description: string;
  kind?: "INVENTORY" | "CONTENT_FEE" | "EXTRA_WORK" | null;
  titleName?: string | null;
  productType?: string | null;
  // EXTRA_WORK lines: the hours billed and the rate they were billed at.
  hours?: unknown;
  hourlyRate?: unknown;
};

export type LabelDeps = {
  // ProductType → localized format name (quoteFormatLabel).
  formatLabel: (productType: string) => string;
  // Localized "Content production" prefix.
  contentProduction: string;
  // Localized "Extra work" prefix, and the "2.5 h × NOK 1,650/h" detail for
  // an extra-work line's hours.
  extraWork: string;
  extraWorkDetail: (hours: number, hourlyRate: number) => string;
};

const PRODUCT_TYPES: ReadonlySet<string> = new Set(Object.values(ProductType));
// A trailing " — ENUM" / " - ENUM" / " · ENUM" segment on a product name.
const TRAILING_ENUM = /\s+[—–\-·]\s+([A-Z][A-Z_]+)\s*$/;

function withFormat(name: string, productType: string | null | undefined, deps: LabelDeps): string {
  if (!productType) return name;
  return `${name} — ${deps.formatLabel(productType)}`;
}

// Legacy: swap a trailing ProductType enum for its label; leave any other
// product name untouched.
function humanizeProductName(name: string, deps: LabelDeps): string {
  const m = TRAILING_ENUM.exec(name);
  if (!m || !PRODUCT_TYPES.has(m[1])) return name;
  return withFormat(name.slice(0, m.index), m[1], deps);
}

export function invoiceLineLabel(line: LabelledInvoiceLine, deps: LabelDeps): string {
  // The desk's own description of the work ("Third revision round"), then
  // the hours it bills.
  if (line.kind === "EXTRA_WORK") {
    const detail =
      line.hours != null && line.hourlyRate != null
        ? ` (${deps.extraWorkDetail(Number(line.hours), Number(line.hourlyRate))})`
        : "";
    return `${deps.extraWork}: ${line.description}${detail}`;
  }
  const feeFor = feePlacementDescription(line.description);
  const isFee = line.kind === "CONTENT_FEE" || feeFor !== null;
  const base = line.titleName
    ? withFormat(line.titleName, line.productType, deps)
    : humanizeProductName(feeFor ?? line.description, deps);
  return isFee ? `${deps.contentProduction}: ${base}` : base;
}
