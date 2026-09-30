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

export type LabelledInvoiceLine = {
  description: string;
  kind?: "INVENTORY" | "CONTENT_FEE" | null;
  titleName?: string | null;
  productType?: string | null;
};

export type LabelDeps = {
  // ProductType → localized format name (quoteFormatLabel).
  formatLabel: (productType: string) => string;
  // Localized "Content production" prefix.
  contentProduction: string;
};

const CONTENT_FEE_PREFIX = "Content production — ";
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
  const isFee = line.kind === "CONTENT_FEE" || line.description.startsWith(CONTENT_FEE_PREFIX);
  const base = line.titleName
    ? withFormat(line.titleName, line.productType, deps)
    : humanizeProductName(
        isFee ? line.description.replace(CONTENT_FEE_PREFIX, "") : line.description,
        deps,
      );
  return isFee ? `${deps.contentProduction}: ${base}` : base;
}
